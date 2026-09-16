/// SuiPad bonding-curve launchpad.
///
/// A generic constant-product bonding curve with virtual reserves (pump.fun
/// style). A creator places a fixed token supply on the curve; anyone can buy
/// with SUI or sell back along the curve. Once the SUI raise reaches the
/// migration threshold, trading is frozen and an admin can withdraw the pooled
/// reserves to seed a DEX pool.
///
/// SECURITY: This contract is provided as a complete, idiomatic starting point.
/// Have it professionally audited and exercised on testnet before deploying to
/// mainnet with real funds.
module suipad_launchpad::launchpad;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin, TreasuryCap};
use sui::sui::SUI;
use sui::event;

// --- Errors -----------------------------------------------------------------
const EMigrated: u64 = 0;
const ESlippage: u64 = 1;
const EInsufficientLiquidity: u64 = 2;
const ENotCreator: u64 = 3;
const ENotReadyToMigrate: u64 = 4;
const EZeroAmount: u64 = 5;

/// Shared bonding-curve object for token `T`.
public struct Curve<phantom T> has key {
    id: UID,
    sui: Balance<SUI>,
    token: Balance<T>,
    fee_sui: Balance<SUI>,
    rs: u64, // virtual SUI reserve
    rt: u64, // virtual token reserve
    virtual_sui_start: u64,
    migrate_threshold: u64,
    fee_bps: u64,
    creator: address,
    migrated: bool,
}

public struct CurveCreated has copy, drop { curve: ID, creator: address, supply: u64 }
public struct Trade has copy, drop { curve: ID, is_buy: bool, sui: u64, token: u64 }
public struct Migrated has copy, drop { curve: ID, sui: u64, token: u64 }

/// Create a curve for token `T`, minting `curve_supply` into the pool.
public fun create<T>(
    mut treasury: TreasuryCap<T>,
    curve_supply: u64,
    virtual_sui: u64,
    migrate_threshold: u64,
    fee_bps: u64,
    ctx: &mut TxContext,
) {
    assert!(curve_supply > 0 && virtual_sui > 0, EZeroAmount);
    let minted = coin::mint(&mut treasury, curve_supply, ctx);
    let curve = Curve<T> {
        id: object::new(ctx),
        sui: balance::zero<SUI>(),
        token: coin::into_balance(minted),
        fee_sui: balance::zero<SUI>(),
        rs: virtual_sui,
        rt: curve_supply,
        virtual_sui_start: virtual_sui,
        migrate_threshold,
        fee_bps,
        creator: ctx.sender(),
        migrated: false,
    };
    event::emit(CurveCreated { curve: object::id(&curve), creator: ctx.sender(), supply: curve_supply });
    transfer::share_object(curve);
    // The mint authority is frozen so total supply is fixed to what's on the curve.
    transfer::public_freeze_object(treasury);
}

/// Buy tokens with SUI. Reverts if output < `min_out`.
public fun buy<T>(curve: &mut Curve<T>, payment: Coin<SUI>, min_out: u64, ctx: &mut TxContext): Coin<T> {
    assert!(!curve.migrated, EMigrated);
    let sui_in = coin::value(&payment);
    assert!(sui_in > 0, EZeroAmount);

    let fee = (((sui_in as u128) * (curve.fee_bps as u128)) / 10000u128) as u64;
    let net_in = sui_in - fee;

    let k = (curve.rs as u128) * (curve.rt as u128);
    let new_rs = curve.rs + net_in;
    // Round the new token reserve UP so tokens paid out are floored — the pool
    // keeps rounding dust and the invariant never decreases (no drain vector).
    let new_rt = ((k + (new_rs as u128) - 1) / (new_rs as u128)) as u64;
    let tokens_out = curve.rt - new_rt;
    assert!(tokens_out >= min_out, ESlippage);
    assert!(tokens_out > 0 && balance::value(&curve.token) >= tokens_out, EInsufficientLiquidity);

    curve.rs = new_rs;
    curve.rt = new_rt;

    let mut pay_bal = coin::into_balance(payment);
    let fee_bal = balance::split(&mut pay_bal, fee);
    balance::join(&mut curve.fee_sui, fee_bal);
    balance::join(&mut curve.sui, pay_bal);

    event::emit(Trade { curve: object::id(curve), is_buy: true, sui: sui_in, token: tokens_out });
    coin::take(&mut curve.token, tokens_out, ctx)
}

/// Sell tokens back to the curve for SUI. Reverts if output < `min_sui_out`.
public fun sell<T>(curve: &mut Curve<T>, tokens: Coin<T>, min_sui_out: u64, ctx: &mut TxContext): Coin<SUI> {
    assert!(!curve.migrated, EMigrated);
    let token_in = coin::value(&tokens);
    assert!(token_in > 0, EZeroAmount);

    let k = (curve.rs as u128) * (curve.rt as u128);
    let new_rt = curve.rt + token_in;
    // Round the new SUI reserve UP so SUI paid out is floored (pool-protective).
    let new_rs = ((k + (new_rt as u128) - 1) / (new_rt as u128)) as u64;
    let gross_out = curve.rs - new_rs;
    let fee = (((gross_out as u128) * (curve.fee_bps as u128)) / 10000u128) as u64;
    let sui_out = gross_out - fee;
    assert!(sui_out >= min_sui_out, ESlippage);
    assert!(sui_out > 0 && balance::value(&curve.sui) >= sui_out, EInsufficientLiquidity);

    curve.rs = new_rs;
    curve.rt = new_rt;

    balance::join(&mut curve.token, coin::into_balance(tokens));
    let fee_bal = balance::split(&mut curve.sui, fee);
    balance::join(&mut curve.fee_sui, fee_bal);

    event::emit(Trade { curve: object::id(curve), is_buy: false, sui: sui_out, token: token_in });
    coin::take(&mut curve.sui, sui_out, ctx)
}

/// True once the SUI raised reaches the migration threshold.
public fun ready_to_migrate<T>(curve: &Curve<T>): bool {
    balance::value(&curve.sui) >= curve.migrate_threshold
}

/// Withdraw pooled reserves after the threshold is met (creator only), to seed
/// a DEX pool. Freezes further curve trading.
public fun migrate<T>(curve: &mut Curve<T>, ctx: &mut TxContext): (Coin<SUI>, Coin<T>) {
    assert!(ctx.sender() == curve.creator, ENotCreator);
    assert!(ready_to_migrate(curve), ENotReadyToMigrate);
    curve.migrated = true;
    let sui_amt = balance::value(&curve.sui);
    let tok_amt = balance::value(&curve.token);
    event::emit(Migrated { curve: object::id(curve), sui: sui_amt, token: tok_amt });
    (
        coin::take(&mut curve.sui, sui_amt, ctx),
        coin::take(&mut curve.token, tok_amt, ctx),
    )
}

/// Creator withdraws accrued curve fees.
public fun claim_fees<T>(curve: &mut Curve<T>, ctx: &mut TxContext): Coin<SUI> {
    assert!(ctx.sender() == curve.creator, ENotCreator);
    let amt = balance::value(&curve.fee_sui);
    coin::take(&mut curve.fee_sui, amt, ctx)
}

// --- Read-only accessors ----------------------------------------------------
public fun reserves<T>(curve: &Curve<T>): (u64, u64) { (curve.rs, curve.rt) }
public fun sui_raised<T>(curve: &Curve<T>): u64 { balance::value(&curve.sui) }
public fun is_migrated<T>(curve: &Curve<T>): bool { curve.migrated }
