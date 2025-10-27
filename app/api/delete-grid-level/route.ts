import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { deleteGridLevel, clearGridLevels } from "@/lib/redis";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { accountId, symbol, side, levelIndex, clearAll } = body;

    if (!accountId || !symbol) {
      return NextResponse.json(
        { error: "Missing accountId or symbol" },
        { status: 400 }
      );
    }

    if (clearAll) {
      // Clear all grid levels for the symbol and side
      if (side) {
        await clearGridLevels(accountId, symbol, side as "buy" | "sell");
      } else {
        await clearGridLevels(accountId, symbol);
      }

      return NextResponse.json({
        success: true,
        message: `Cleared all ${side || "buy and sell"} grid levels for ${symbol}`,
      });
    } else {
      // Delete specific grid level
      if (!side || levelIndex === undefined) {
        return NextResponse.json(
          { error: "Missing side or levelIndex" },
          { status: 400 }
        );
      }

      await deleteGridLevel(accountId, symbol, side as "buy" | "sell", levelIndex);

      return NextResponse.json({
        success: true,
        message: `Deleted grid level ${levelIndex}`,
      });
    }
  } catch (error: any) {
    console.error("Error deleting grid level:", error);
    return NextResponse.json(
      { error: error.message || "Failed to delete grid level" },
      { status: 500 }
    );
  }
}
