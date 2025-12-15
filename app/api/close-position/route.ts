import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchItems } from "@/lib/directus";
import { OKXClient } from "@/lib/okx";
import { AsterdexClient } from "@/lib/asterdex";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { accountId, percentage, symbol } = await request.json();

    if (!accountId || !percentage) {
      return NextResponse.json(
        { error: "Missing accountId or percentage" },
        { status: 400 }
      );
    }

    if (!symbol) {
      return NextResponse.json(
        { error: "Missing symbol" },
        { status: 400 }
      );
    }

    if (percentage < 10 || percentage > 100) {
      return NextResponse.json(
        { error: "Percentage must be between 10 and 100" },
        { status: 400 }
      );
    }

    const accounts = await fetchItems("trading_accounts", {
      filter: { id: { _eq: accountId } },
      fields: ["*"],
    });

    if (!accounts || (Array.isArray(accounts) && accounts.length === 0)) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const account = Array.isArray(accounts) ? accounts[0] : accounts;

    const apiKey = account.api_key || process.env.OKX_API_KEY;
    const apiSecret = account.api_secret || process.env.OKX_API_SECRET;
    const passphrase = account.api_passphrase || process.env.OKX_PASSPHRASE;

    if (!apiKey || !apiSecret || !passphrase) {
      return NextResponse.json(
        { error: "Missing API credentials" },
        { status: 500 }
      );
    }

    const exchange = account.exchange || "okx";

    if (exchange === "asterdex") {
      const asterdex = new AsterdexClient(apiKey, apiSecret, true);

      const positionsResponse = await asterdex.getPositions(symbol);
      const positions = Array.isArray(positionsResponse)
        ? positionsResponse
        : positionsResponse?.data || [];
      const activePositions = positions.filter(
        (pos: any) => (pos.symbol || pos.s) === symbol && Math.abs(Number(pos.positionAmt || pos.pa || 0)) > 0
      );

      if (activePositions.length === 0) {
        return NextResponse.json({
          success: true,
          message: "No positions to close",
          results: [],
        });
      }

      const results = [];
      for (const position of activePositions) {
        try {
          const posSize = Number(position.positionAmt || position.pa || 0);
          const absSize = Math.abs(posSize);
          const closeSize = (absSize * percentage) / 100;

          const closeSide = posSize > 0 ? "SELL" : "BUY";

          const orderData = {
            symbol: symbol,
            side: closeSide,
            type: "MARKET",
            quantity: closeSize.toFixed(2),
          };

          console.log(`[Asterdex] Placing close order:`, orderData);
          const response = await asterdex.placeOrder(orderData);
          console.log(`[Asterdex] Close order response:`, JSON.stringify(response));

          // Check if order was successful
          const isSuccess = response.orderId || response.clientOrderId || response.i;

          results.push({
            symbol: symbol,
            success: !!isSuccess,
            orderId: response.orderId || response.clientOrderId || response.i,
            closeSize,
            percentage,
            error: !isSuccess ? (response.msg || response.message || "Unknown error") : undefined,
          });
        } catch (error: any) {
          console.error(`[Asterdex] Error closing position:`, error);
          console.error(`[Asterdex] Error details:`, {
            message: error.message,
            response: error.response?.data,
            status: error.response?.status,
          });

          results.push({
            symbol: symbol,
            success: false,
            error: error.response?.data?.msg || error.response?.data?.message || error.message,
            closeSize: 0,
            percentage,
          });
        }
      }

      return NextResponse.json({ success: true, results });
    }

    const okx = new OKXClient(apiKey, apiSecret, passphrase);

    const positionsResponse = await okx.getPositions("SWAP");
    const positions = positionsResponse.data.filter(
      (pos: any) =>
        pos.instId === symbol && Math.abs(Number(pos.pos)) > 0
    );

    if (positions.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No positions to close",
        results: [],
      });
    }

    const instrumentResponse = await okx.getInstrumentInfo(symbol);
    const lotSz =
      instrumentResponse.code === "0" && instrumentResponse.data.length > 0
        ? parseFloat(instrumentResponse.data[0].lotSz)
        : 1;

    const results = [];
    for (const position of positions) {
      try {
        const posSize = Number(position.pos);
        const absSize = Math.abs(posSize);
        const rawCloseSize = (absSize * percentage) / 100;

        const closeSize = Math.floor(rawCloseSize / lotSz) * lotSz;

        if (closeSize < lotSz) {
          results.push({
            symbol: position.instId,
            success: false,
            error: `Close size ${closeSize} is less than minimum lot size ${lotSz}`,
            closeSize: 0,
            percentage,
          });
          continue;
        }

        const closeSide = posSize > 0 ? "sell" : "buy";

        const orderData: any = {
          instId: position.instId,
          tdMode: position.mgnMode || "cross",
          side: closeSide,
          ordType: "market",
          sz: closeSize.toString(),
        };

        if (position.posSide && position.posSide !== "net") {
          orderData.posSide = position.posSide;
        }

        const response = await okx.placeOrder(orderData);

        results.push({
          symbol: position.instId,
          success: response.code === "0",
          orderId: response.code === "0" ? response.data[0].ordId : null,
          error: response.code !== "0" ? response.msg : null,
          closeSize,
          percentage,
        });

        if (positions.length > 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (error: any) {
        results.push({
          symbol: position.instId,
          success: false,
          error: error.message,
          closeSize: 0,
          percentage,
        });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (error: any) {
    console.error("Error closing position:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
