"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

interface Position {
  symbol: string;
  side: string;
  positionAmt: string;
  entryPrice: string;
  unRealizedProfit: string;
  leverage: string;
  notional: string;
  updateTime: number;
}

interface Income {
  symbol: string;
  income: string;
  incomeType: string;
  asset: string;
  info: string;
  time: number;
}

interface Trade {
  symbol: string;
  id: number;
  orderId: number;
  side: string;
  price: string;
  qty: string;
  realizedPnl: string;
  commission: string;
  commissionAsset: string;
  time: number;
  buyer: boolean;
  maker: boolean;
}

export default function TradeHistoryPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [accountId, setAccountId] = useState("");
  const [positions, setPositions] = useState<Position[]>([]);
  const [closedPositions, setClosedPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  const fetchTradeHistory = async () => {
    if (!accountId) {
      setError("Please enter an account ID");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Fetch last 30 days of data
      const endTime = Date.now();
      const startTime = endTime - 30 * 24 * 60 * 60 * 1000;

      const response = await fetch(
        `/api/trade-history?accountId=${accountId}&startTime=${startTime}&endTime=${endTime}&limit=500`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch trade history");
      }

      const data = await response.json();

      // Group trades by symbol to create closed position history
      const tradesBySymbol: { [key: string]: Trade[] } = {};
      (data.trades || []).forEach((trade: Trade) => {
        if (!tradesBySymbol[trade.symbol]) {
          tradesBySymbol[trade.symbol] = [];
        }
        tradesBySymbol[trade.symbol].push(trade);
      });

      // Calculate closed positions from realized PnL income
      const closedPosMap: { [key: string]: any } = {};
      (data.income || []).forEach((inc: Income) => {
        if (inc.incomeType === "REALIZED_PNL" && parseFloat(inc.income) !== 0) {
          const key = `${inc.symbol}_${inc.time}`;
          if (!closedPosMap[key]) {
            closedPosMap[key] = {
              symbol: inc.symbol,
              realizedPnl: parseFloat(inc.income),
              time: inc.time,
              trades: tradesBySymbol[inc.symbol] || [],
            };
          }
        }
      });

      const closedPos = Object.values(closedPosMap)
        .sort((a, b) => b.time - a.time)
        .map((pos: any) => {
          const symbolTrades = pos.trades.filter(
            (t: Trade) => Math.abs(t.time - pos.time) < 60000 * 10 // Within 10 minutes
          );

          let entryPrice = 0;
          let exitPrice = 0;
          let maxHeld = 0;
          let roe = 0;

          if (symbolTrades.length > 0) {
            const sortedTrades = [...symbolTrades].sort((a, b) => a.time - b.time);
            entryPrice = parseFloat(sortedTrades[0].price);
            exitPrice = parseFloat(sortedTrades[sortedTrades.length - 1].price);

            // Calculate max position held
            let runningQty = 0;
            symbolTrades.forEach((t: Trade) => {
              const qty = parseFloat(t.qty);
              runningQty = t.side === "BUY" ? runningQty + qty : runningQty - qty;
              maxHeld = Math.max(maxHeld, Math.abs(runningQty * parseFloat(t.price)));
            });

            if (maxHeld > 0) {
              roe = (pos.realizedPnl / maxHeld) * 100;
            }
          }

          return {
            ...pos,
            entryPrice,
            exitPrice,
            maxHeld,
            roe,
          };
        });

      setPositions(data.positions || []);
      setClosedPositions(closedPos);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8 bg-gradient-to-br from-cyan-500/20 via-blue-500/20 to-purple-500/20">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold mb-8">Trade History</h1>

        {/* Account ID Input */}
        <div className="mb-6 flex gap-4">
          <input
            type="text"
            placeholder="Enter Account ID"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900"
          />
          <button
            onClick={fetchTradeHistory}
            disabled={loading}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
          >
            {loading ? "Loading..." : "Fetch History"}
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500 rounded-lg text-red-500">
            {error}
          </div>
        )}

        {/* Active Trades */}
        {positions.length > 0 && (
          <div className="mb-8">
            <h2 className="text-2xl font-semibold mb-4 text-cyan-400">
              • Active Trades
            </h2>
            <div className="bg-black/40 backdrop-blur-sm border-2 border-white rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-900">
                    <th className="px-6 py-4 text-left font-bold">Symbol</th>
                    <th className="px-6 py-4 text-left font-bold">Side</th>
                    <th className="px-6 py-4 text-left font-bold">Value</th>
                    <th className="px-6 py-4 text-left font-bold">ROE %</th>
                    <th className="px-6 py-4 text-left font-bold">UnPnL</th>
                  </tr>
                </thead>
                <tbody>
                  {positions
                    .filter((pos) => Math.abs(parseFloat(pos.positionAmt)) > 0)
                    .map((pos, idx) => {
                      const isLong = parseFloat(pos.positionAmt) > 0;
                      const unrealizedPnl = parseFloat(pos.unRealizedProfit);
                      const notional = Math.abs(parseFloat(pos.notional));
                      const roe = notional > 0 ? (unrealizedPnl / notional) * 100 : 0;

                      return (
                        <tr key={idx} className="border-t border-gray-700">
                          <td className="px-6 py-4 font-mono">
                            {pos.symbol.replace("USDT", "/USDT")}
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`px-3 py-1 rounded font-bold ${
                                isLong
                                  ? "bg-green-500 text-white"
                                  : "bg-red-500 text-white"
                              }`}
                            >
                              {isLong ? "LONG" : "SHORT"}
                            </span>
                          </td>
                          <td className="px-6 py-4">${notional.toFixed(2)}</td>
                          <td
                            className={`px-6 py-4 font-bold ${
                              roe >= 0 ? "text-green-400" : "text-red-400"
                            }`}
                          >
                            {roe >= 0 ? "+" : ""}
                            {roe.toFixed(1)}%
                          </td>
                          <td
                            className={`px-6 py-4 font-bold ${
                              unrealizedPnl >= 0 ? "text-green-400" : "text-red-400"
                            }`}
                          >
                            {unrealizedPnl >= 0 ? "+" : ""}$
                            {unrealizedPnl.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* History Positions */}
        {closedPositions.length > 0 && (
          <div>
            <h2 className="text-2xl font-semibold mb-4 text-cyan-400">
              • History Positions
            </h2>
            <div className="bg-black/40 backdrop-blur-sm border-2 border-white rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-900">
                    <th className="px-6 py-4 text-left font-bold">Symbol</th>
                    <th className="px-6 py-4 text-left font-bold">
                      Entry Price
                    </th>
                    <th className="px-6 py-4 text-left font-bold">
                      Exit Price
                    </th>
                    <th className="px-6 py-4 text-left font-bold">
                      Realized PnL
                    </th>
                    <th className="px-6 py-4 text-left font-bold">ROE</th>
                    <th className="px-6 py-4 text-left font-bold">Max Held</th>
                    <th className="px-6 py-4 text-left font-bold">Closed</th>
                    <th className="px-6 py-4 text-left font-bold">
                      Time Closed
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {closedPositions.map((pos, idx) => {
                    const pnl = pos.realizedPnl;
                    const isProfitable = pnl > 0;

                    return (
                      <tr key={idx} className="border-t border-gray-700">
                        <td className="px-6 py-4 font-mono">
                          {pos.symbol.replace("USDT", " Perpetual 10x")}
                        </td>
                        <td className="px-6 py-4">
                          {pos.entryPrice > 0
                            ? pos.entryPrice.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })
                            : "-"}
                        </td>
                        <td className="px-6 py-4">
                          {pos.exitPrice > 0
                            ? pos.exitPrice.toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })
                            : "-"}
                        </td>
                        <td
                          className={`px-6 py-4 font-bold ${
                            isProfitable ? "text-green-400" : "text-red-400"
                          }`}
                        >
                          {isProfitable ? "+" : ""}
                          {pnl.toFixed(2)} USDT
                        </td>
                        <td
                          className={`px-6 py-4 font-bold ${
                            isProfitable ? "text-green-400" : "text-red-400"
                          }`}
                        >
                          {isProfitable ? "+" : ""}
                          {pos.roe.toFixed(2)}%
                        </td>
                        <td className="px-6 py-4">
                          {pos.maxHeld > 0
                            ? `${pos.maxHeld.toFixed(2)} USDT Cross`
                            : "-"}
                        </td>
                        <td className="px-6 py-4">
                          {pos.maxHeld > 0
                            ? `${pos.maxHeld.toFixed(2)} USDT`
                            : "-"}
                        </td>
                        <td className="px-6 py-4">
                          {new Date(pos.time).toLocaleString("en-US", {
                            month: "2-digit",
                            day: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                            hour12: false,
                          })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && positions.length === 0 && closedPositions.length === 0 && accountId && (
          <div className="text-center text-gray-500 py-12">
            No trade history found for this account.
          </div>
        )}
      </div>
    </div>
  );
}
