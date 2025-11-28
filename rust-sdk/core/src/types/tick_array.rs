//
// Copyright (c) Cryptic Dot
//
// Modification based on Orca Whirlpools (https://github.com/orca-so/whirlpools),
// originally licensed under the Apache License, Version 2.0, prior to February 26, 2025.
//
// Modifications licensed under FusionAMM SDK Source-Available License v1.0
// See the LICENSE file in the project root for license information.
//

use crate::types::TickArrayFacade;

#[cfg(not(feature = "wasm"))]
#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(clippy::large_enum_variant)]
pub enum TickArrays {
    One(TickArrayFacade),
    Two(TickArrayFacade, TickArrayFacade),
    Three(TickArrayFacade, TickArrayFacade, TickArrayFacade),
    Four(TickArrayFacade, TickArrayFacade, TickArrayFacade, TickArrayFacade),
    Five(TickArrayFacade, TickArrayFacade, TickArrayFacade, TickArrayFacade, TickArrayFacade),
    Six(TickArrayFacade, TickArrayFacade, TickArrayFacade, TickArrayFacade, TickArrayFacade, TickArrayFacade),
}

#[cfg(feature = "wasm")]
use core::fmt::{Debug, Formatter, Result as FmtResult};

#[cfg(feature = "wasm")]
use js_sys::Array;

#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

#[cfg(feature = "wasm")]
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(typescript_type = "TickArrayFacade[]")]
    pub type TickArrays;
}

#[cfg(feature = "wasm")]
impl Debug for TickArrays {
    fn fmt(&self, f: &mut Formatter<'_>) -> FmtResult {
        write!(f, "{:?}", JsValue::from(self))
    }
}

#[cfg(feature = "wasm")]
impl From<TickArrays> for Vec<TickArrayFacade> {
    fn from(val: TickArrays) -> Self {
        let val = JsValue::from(val);
        if !val.is_array() {
            return vec![];
        }
        let array: Array = val.unchecked_into();
        let mut result = vec![];
        for (_, item) in array.iter().enumerate() {
            if let Ok(item) = serde_wasm_bindgen::from_value(item) {
                result.push(item);
            }
        }
        result
    }
}

#[cfg(not(feature = "wasm"))]
impl From<TickArrays> for Vec<TickArrayFacade> {
    fn from(val: TickArrays) -> Self {
        match val {
            TickArrays::One(tick_array) => {
                vec![tick_array]
            }
            TickArrays::Two(tick_array_1, tick_array_2) => {
                vec![tick_array_1, tick_array_2]
            }
            TickArrays::Three(tick_array_1, tick_array_2, tick_array_3) => {
                vec![tick_array_1, tick_array_2, tick_array_3]
            }
            TickArrays::Four(tick_array_1, tick_array_2, tick_array_3, tick_array_4) => {
                vec![tick_array_1, tick_array_2, tick_array_3, tick_array_4]
            }
            TickArrays::Five(tick_array_1, tick_array_2, tick_array_3, tick_array_4, tick_array_5) => {
                vec![tick_array_1, tick_array_2, tick_array_3, tick_array_4, tick_array_5]
            }
            TickArrays::Six(tick_array_1, tick_array_2, tick_array_3, tick_array_4, tick_array_5, tick_array_6) => {
                vec![tick_array_1, tick_array_2, tick_array_3, tick_array_4, tick_array_5, tick_array_6]
            }
        }
    }
}

#[cfg(not(feature = "wasm"))]
impl From<TickArrayFacade> for TickArrays {
    fn from(val: TickArrayFacade) -> Self {
        TickArrays::One(val)
    }
}

#[cfg(not(feature = "wasm"))]
impl From<[TickArrayFacade; 1]> for TickArrays {
    fn from(val: [TickArrayFacade; 1]) -> Self {
        TickArrays::One(val[0])
    }
}

#[cfg(not(feature = "wasm"))]
impl From<[TickArrayFacade; 2]> for TickArrays {
    fn from(val: [TickArrayFacade; 2]) -> Self {
        TickArrays::Two(val[0], val[1])
    }
}

#[cfg(not(feature = "wasm"))]
impl From<[TickArrayFacade; 3]> for TickArrays {
    fn from(val: [TickArrayFacade; 3]) -> Self {
        TickArrays::Three(val[0], val[1], val[2])
    }
}

#[cfg(not(feature = "wasm"))]
impl From<[TickArrayFacade; 4]> for TickArrays {
    fn from(val: [TickArrayFacade; 4]) -> Self {
        TickArrays::Four(val[0], val[1], val[2], val[3])
    }
}

#[cfg(not(feature = "wasm"))]
impl From<[TickArrayFacade; 5]> for TickArrays {
    fn from(val: [TickArrayFacade; 5]) -> Self {
        TickArrays::Five(val[0], val[1], val[2], val[3], val[4])
    }
}

#[cfg(not(feature = "wasm"))]
impl From<[TickArrayFacade; 6]> for TickArrays {
    fn from(val: [TickArrayFacade; 6]) -> Self {
        TickArrays::Six(val[0], val[1], val[2], val[3], val[4], val[5])
    }
}
