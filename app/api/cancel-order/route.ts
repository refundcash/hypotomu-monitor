import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchItems } from "@/lib/directus";
import { OKXClient } from "@/lib/okx";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { accountId, orderId, instId } = await request.json();

    if (!accountId || !orderId || !instId) {
      return NextResponse.json(
        { error: "Missing required parameters" },
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

    const okx = new OKXClient(apiKey, apiSecret, passphrase);
    const response = await okx.cancelOrder(instId, orderId);

    if (response.code === "0") {
      return NextResponse.json({
        success: true,
        message: "Order cancelled successfully",
      });
    } else {
      return NextResponse.json(
        { success: false, error: response.msg },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error("Error cancelling order:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
