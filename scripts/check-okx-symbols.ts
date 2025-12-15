/**
 * Script to check and validate OKX account symbols in Directus
 *
 * Run with: npx tsx scripts/check-okx-symbols.ts
 */

import { fetchItems } from "../lib/directus";

interface Account {
  id: string;
  name: string;
  symbol: string;
  exchange?: string;
  status: string;
}

// Symbol format validation
const SYMBOL_FORMATS = {
  okx: /^[A-Z]+-USDT-SWAP$/,        // e.g., ETH-USDT-SWAP
  asterdex: /^[A-Z]+USDT$/,          // e.g., ETHUSDT
};

// Common symbol mappings
const SYMBOL_MAPPINGS: Record<string, { okx: string; asterdex: string }> = {
  ETH: { okx: "ETH-USDT-SWAP", asterdex: "ETHUSDT" },
  BTC: { okx: "BTC-USDT-SWAP", asterdex: "BTCUSDT" },
  SOL: { okx: "SOL-USDT-SWAP", asterdex: "SOLUSDT" },
  BNB: { okx: "BNB-USDT-SWAP", asterdex: "BNBUSDT" },
  PUMP: { okx: "PUMP-USDT-SWAP", asterdex: "PUMPUSDT" },
  ASTER: { okx: "ASTER-USDT-SWAP", asterdex: "ASTERUSDT" },
};

function validateSymbol(symbol: string, exchange: string): boolean {
  const format = SYMBOL_FORMATS[exchange as keyof typeof SYMBOL_FORMATS];
  if (!format) {
    console.warn(`⚠️  Unknown exchange: ${exchange}`);
    return false;
  }
  return format.test(symbol);
}

function suggestCorrection(symbol: string, exchange: string): string | null {
  // Try to extract base asset
  const baseAsset = symbol.replace(/[-]?USDT[-]?SWAP?/, "").replace(/-/g, "");

  const mapping = SYMBOL_MAPPINGS[baseAsset];
  if (mapping) {
    return mapping[exchange as keyof typeof mapping];
  }

  return null;
}

async function checkSymbols() {
  console.log("🔍 Checking OKX account symbols in Directus...\n");

  const accounts = await fetchItems<Account[]>("trading_accounts", {
    filter: {
      status: { _eq: "active" },
    },
    limit: -1,
    fields: ["id", "name", "symbol", "exchange", "status"],
  });

  console.log(`Found ${accounts.length} active accounts\n`);

  let hasIssues = false;

  for (const account of accounts) {
    const exchange = account.exchange || "okx";
    const isValid = validateSymbol(account.symbol, exchange);

    if (!isValid) {
      hasIssues = true;
      const suggested = suggestCorrection(account.symbol, exchange);

      console.log(`❌ Account: ${account.name} (${account.id})`);
      console.log(`   Exchange: ${exchange}`);
      console.log(`   Current Symbol: ${account.symbol}`);
      console.log(`   Issue: Invalid symbol format for ${exchange}`);

      if (suggested) {
        console.log(`   ✅ Suggested: ${suggested}`);
      }
      console.log("");
    } else {
      console.log(`✅ Account: ${account.name} - Symbol: ${account.symbol} (${exchange})`);
    }
  }

  if (hasIssues) {
    console.log("\n⚠️  ISSUES FOUND!");
    console.log("\nTo fix these issues:");
    console.log("1. Go to Directus → trading_accounts");
    console.log("2. Edit each account with invalid symbols");
    console.log("3. Update the symbol field to the suggested format");
    console.log("\nSymbol Format Rules:");
    console.log("  - OKX: Use hyphens (e.g., ETH-USDT-SWAP)");
    console.log("  - AsterDex: No hyphens (e.g., ETHUSDT)");
  } else {
    console.log("\n✅ All symbols are valid!");
  }
}

checkSymbols().catch(console.error);
