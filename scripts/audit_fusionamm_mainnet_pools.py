#!/usr/bin/env python3

import argparse
import base64
import json
import struct
import sys
import urllib.request
from pathlib import Path

FUSIONAMM_PROGRAM = "fUSioN9YKKSa3CUC2YUc4tPkHJ5Y6XW1yz8y6F7qWz9"
TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def base58_encode(data: bytes) -> str:
    number = int.from_bytes(data, "big")
    encoded = ""
    while number > 0:
        number, remainder = divmod(number, 58)
        encoded = BASE58_ALPHABET[remainder] + encoded

    prefix = 0
    for byte in data:
        if byte != 0:
            break
        prefix += 1

    return "1" * prefix + (encoded or "1")


def rpc_request(rpc_url: str, method: str, params: list[object]) -> object:
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    request = urllib.request.Request(rpc_url, data=payload, headers={"content-type": "application/json"})

    with urllib.request.urlopen(request, timeout=60) as response:
        body = json.loads(response.read())

    if "error" in body:
        raise RuntimeError(body["error"])

    return body["result"]


def fusion_pool_discriminator(idl_path: Path) -> bytes:
    idl = json.loads(idl_path.read_text())
    for account in idl["accounts"]:
        if account["name"] == "FusionPool":
            return bytes(account["discriminator"])
    raise RuntimeError("FusionPool discriminator not found in IDL")


def decode_fusion_pool(account_data: bytes) -> tuple[str, str, int]:
    offset = 8 + 1 + 2
    token_mint_a = base58_encode(account_data[offset:offset + 32])
    offset += 32
    token_mint_b = base58_encode(account_data[offset:offset + 32])
    offset += 32
    offset += 32 + 32
    tick_spacing = struct.unpack_from("<H", account_data, offset)[0]
    return token_mint_a, token_mint_b, tick_spacing


def fetch_mint_owners(rpc_url: str, mints: list[str]) -> dict[str, str | None]:
    owners: dict[str, str | None] = {}
    for index in range(0, len(mints), 100):
        chunk = mints[index:index + 100]
        result = rpc_request(rpc_url, "getMultipleAccounts", [chunk, {"encoding": "base64"}])
        for mint, account in zip(chunk, result["value"]):
            owners[mint] = None if account is None else account["owner"]
    return owners


def fetch_mint_extensions(rpc_url: str, mints: list[str]) -> dict[str, list[str]]:
    extensions: dict[str, list[str]] = {}
    for index in range(0, len(mints), 100):
        chunk = mints[index:index + 100]
        result = rpc_request(rpc_url, "getMultipleAccounts", [chunk, {"encoding": "jsonParsed"}])
        for mint, account in zip(chunk, result["value"]):
            parsed = None if account is None else account["data"].get("parsed", {}).get("info", {})
            extension_info = [] if parsed is None else parsed.get("extensions", [])
            extensions[mint] = [extension["extension"] for extension in extension_info]
    return extensions


def classify_pool(owner_a: str | None, owner_b: str | None) -> str:
    program_a = "token2022" if owner_a == TOKEN_2022_PROGRAM else "token"
    program_b = "token2022" if owner_b == TOKEN_2022_PROGRAM else "token"
    return "/".join(sorted([program_a, program_b]))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Summarize live FusionAMM pools by token program and Token-2022 extension surface.",
    )
    parser.add_argument("--rpc-url", required=True, help="RPC URL to query")
    parser.add_argument(
        "--idl",
        default="target/idl/fusionamm.json",
        help="Path to the checked-in FusionAMM IDL",
    )
    args = parser.parse_args()

    discriminator = fusion_pool_discriminator(Path(args.idl))
    accounts = rpc_request(args.rpc_url, "getProgramAccounts", [FUSIONAMM_PROGRAM, {"encoding": "base64"}])

    pools = []
    for account in accounts:
        raw = base64.b64decode(account["account"]["data"][0])
        if raw[:8] != discriminator:
            continue

        token_mint_a, token_mint_b, tick_spacing = decode_fusion_pool(raw)
        pools.append({
            "pool": account["pubkey"],
            "token_mint_a": token_mint_a,
            "token_mint_b": token_mint_b,
            "tick_spacing": tick_spacing,
        })

    unique_mints = sorted({pool["token_mint_a"] for pool in pools} | {pool["token_mint_b"] for pool in pools})
    mint_owners = fetch_mint_owners(args.rpc_url, unique_mints)
    token_2022_mints = sorted(mint for mint, owner in mint_owners.items() if owner == TOKEN_2022_PROGRAM)
    token_2022_extensions = fetch_mint_extensions(args.rpc_url, token_2022_mints)

    by_category: dict[str, list[dict[str, object]]] = {}
    for pool in pools:
        category = classify_pool(
            mint_owners.get(pool["token_mint_a"]),
            mint_owners.get(pool["token_mint_b"]),
        )
        by_category.setdefault(category, []).append(pool)

    print(f"fusion_pool_count: {len(pools)}")
    for category in ["token/token", "token/token2022", "token2022/token2022"]:
        category_pools = by_category.get(category, [])
        print(f"{category}: {len(category_pools)}")
        for pool in category_pools[:5]:
            print(
                "  "
                f"{pool['pool']} tick_spacing={pool['tick_spacing']} "
                f"mint_a={pool['token_mint_a']} mint_b={pool['token_mint_b']}"
            )

    print("token2022_extensions:")
    for mint in token_2022_mints:
        extensions = token_2022_extensions.get(mint, [])
        print(f"  {mint}: {', '.join(extensions) if extensions else '(none)'}")

    if not by_category.get("token2022/token2022"):
        print("note: no live token2022/token2022 pools were found on this RPC snapshot")

    return 0


if __name__ == "__main__":
    sys.exit(main())
