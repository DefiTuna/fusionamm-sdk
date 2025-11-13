# @crypticdot/fusionamm-rust-core

## 1.0.68

### Patch Changes

- ef0888b: Got rid of TickArraySequence and renamed the optimized TickArraySequenceVec to TickArraySequence

## 1.0.67

## 1.0.66

### Patch Changes

- 3020148: Simplified limit order rewards calculation math

## 1.0.65

### Patch Changes

- 9606b26: Added limit_order_reward_by_output_token()

## 1.0.64

## 1.0.63

### Patch Changes

- 74e1d40: Fixed incorrect math in limit_order_quote_by_input_token()

## 1.0.62

### Patch Changes

- 99f630c: Added MA price

## 1.0.61

## 1.0.60

## 1.0.59

### Patch Changes

- 386c7fa: Updated get_order_book_side (min/max price fix)

## 1.0.58

### Patch Changes

- 2a3bb9b: Updated get_order_book_side

## 1.0.57

## 1.0.56

### Patch Changes

- 4abedb0: Added limit order fees calculation

## 1.0.55

## 1.0.54

## 1.0.53

### Patch Changes

- d71dcc0: Updated limit orders fee model

## 1.0.52

### Patch Changes

- ca86f83: bugifx: incorrect charging of the protocol fee for limit order swaps

## 1.0.51

### Patch Changes

- 7e2b2dd: New limit orders fee model and bug fixes

## 1.0.50

## 1.0.49

### Patch Changes

- 45bbc14: Added limit order instruction helpers for rust

## 1.0.48

### Patch Changes

- 9e28edd: Added next_sqrt_price to the swap quote functions return result

## 1.0.47

## 1.0.46

### Patch Changes

- 45b7e05: bugfix: overflow in test_position_ratio_x64

## 1.0.45

### Patch Changes

- db0f8c1: bugfix: incorrect order book entries when the price is at a tick boundary

## 1.0.44

## 1.0.43

## 1.0.42

### Patch Changes

- 764fc7c: Changed packages scope to @crypticdot
- 3238f6c: Increased precision of position_ratio function and renamed to position_ratio_x64

## 1.0.41

### Patch Changes

- 3238f6c: Increased precision of position_ratio function and renamed to position_ratio_x64

## 1.0.40

### Patch Changes

- b77aaed: Made public liquidity calculation functions

## 1.0.39

### Patch Changes

- cc8ee99: Changed program address and increased accounts reserve

## 1.0.38

### Patch Changes

- b362cfd: Decreased the order book minimal allowed step

## 1.0.37

## 1.0.36

## 1.0.35

### Patch Changes

- 5d28300: Optimized order book building

## 1.0.34

### Patch Changes

- 4f9be31: Changed FusionPoolsConfig, removed FusionConfigExtension, updated tests

## 1.0.33

### Patch Changes

- 3172e82: bugfix: protocol fee is not applied to orders liquidity
