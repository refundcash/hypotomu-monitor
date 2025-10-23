"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { signOut } from "next-auth/react";
import { ThemeToggle } from "@/components/theme-toggle";
import { SkeletonCard } from "@/components/skeleton-card";

interface Position {
  side: "LONG" | "SHORT";
  contracts: number;
  avgPrice: number;
  unrealizedPnL: number;
  unrealizedPnLRatio: number;
  leverage: number;
  notionalUsd: number;
  instId: string;
}

interface Order {
  price: number;
  size: number;
  value: number;
  orderId: string;
  instId: string;
}

interface Balance {
  equity: number;
  availableBalance: number;
  balanceInUse: number;
  unrealizedPnL: number;
  equity24hAgo?: number | null;
  equity24hChange?: number | null;
  equity24hChangePercent?: number | null;
}

interface Account {
  accountId: string;
  accountName: string;
  symbol: string;
  currentPrice?: number;
  balance?: Balance;
  positions: Position[];
  buyOrders: Order[];
  sellOrders: Order[];
  error?: string;
}

interface MonitorData {
  timestamp: string;
  accounts: Account[];
}

export default function HomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [data, setData] = useState<MonitorData | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  const fetchData = async () => {
    try {
      setError(null);
      const response = await fetch("/api/monitor");
      if (!response.ok) {
        throw new Error("Failed to fetch data");
      }
      const result = await response.json();
      setData(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      if (isInitialLoading) {
        setIsInitialLoading(false);
      }
    }
  };

  useEffect(() => {
    if (status === "authenticated") {
      fetchData();
      const interval = setInterval(fetchData, 60000);
      return () => clearInterval(interval);
    }
  }, [status]);

  const closePosition = async (accountId: string, percentage: number) => {
    if (!confirm(`Close ${percentage}% of positions?`)) return;

    try {
      const response = await fetch("/api/close-position", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, percentage }),
      });

      const result = await response.json();
      if (result.success) {
        alert("Position closed successfully!");
        fetchData();
      } else {
        alert("Error: " + (result.error || "Unknown error"));
      }
    } catch (error: any) {
      alert("Failed to close position: " + error.message);
    }
  };

  const cancelOrder = async (accountId: string, orderId: string, instId: string) => {
    if (!confirm("Cancel this order?")) return;

    try {
      const response = await fetch("/api/cancel-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, orderId, instId }),
      });

      const result = await response.json();
      if (result.success) {
        alert("Order cancelled successfully!");
        fetchData();
      } else {
        alert("Error: " + (result.error || "Unknown error"));
      }
    } catch (error: any) {
      alert("Failed to cancel order: " + error.message);
    }
  };

  const cancelAllOrders = async (accountId: string) => {
    if (!confirm("Cancel ALL orders?")) return;

    try {
      const response = await fetch("/api/cancel-all-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });

      const result = await response.json();
      if (result.success) {
        alert(`Cancelled ${result.cancelledCount} orders!`);
        fetchData();
      } else {
        alert("Error: " + (result.error || "Unknown error"));
      }
    } catch (error: any) {
      alert("Failed to cancel orders: " + error.message);
    }
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background p-4 lg:p-8">
      <div className="max-w-[1800px] mx-auto">
        <div className="flex justify-between items-center mb-6 pb-4 border-b">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">Grid Market Maker Monitor</h1>
            <div className="text-xs lg:text-sm text-muted-foreground mt-1">
              {data ? `Last updated: ${new Date(data.timestamp).toLocaleString()}` : "Loading..."}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              onClick={() => signOut()}
              variant="outline"
            >
              Sign Out
            </Button>
          </div>
        </div>

        {error && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-lg mb-6">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-6">
          {isInitialLoading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : (
            data?.accounts.map((account) => (
              <Card key={account.accountId} className="overflow-hidden">
              <CardHeader className="pb-4">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-lg lg:text-xl truncate">
                      {account.accountName}
                    </CardTitle>
                    <div className="text-xs lg:text-sm text-muted-foreground mt-1">{account.symbol}</div>
                  </div>
                  <Badge variant="outline" className="text-xs shrink-0">
                    #{String(account.accountId).slice(0, 8)}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="pt-6 space-y-6">
                {account.error ? (
                  <div className="bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-lg">
                    {account.error}
                  </div>
                ) : (
                  <>
                    {account.balance && (
                      <div className="bg-muted/50 rounded-lg p-4 border">
                        <div className="flex flex-wrap gap-6">
                          <div className="flex-1 min-w-[120px]">
                            <div className="text-xs text-muted-foreground mb-1.5">Equity</div>
                            <div className="text-xl font-bold">
                              ${account.balance.equity.toFixed(2)}
                            </div>
                            {account.balance.equity24hChange !== null &&
                             account.balance.equity24hChange !== undefined && (
                              <div
                                className={`text-xs mt-1 font-medium ${
                                  account.balance.equity24hChange >= 0
                                    ? "text-green-600"
                                    : "text-red-600"
                                }`}
                              >
                                24h: {account.balance.equity24hChange >= 0 ? "+" : ""}
                                ${account.balance.equity24hChange.toFixed(2)} (
                                {account.balance.equity24hChangePercent?.toFixed(2)}%)
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-[120px]">
                            <div className="text-xs text-muted-foreground mb-1.5">Available</div>
                            <div className="text-xl font-bold">
                              ${account.balance.availableBalance.toFixed(2)}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">Balance</div>
                          </div>
                          <div className="flex-1 min-w-[120px]">
                            <div className="text-xs text-muted-foreground mb-1.5">In Use</div>
                            <div className="text-xl font-bold">
                              ${account.balance.balanceInUse.toFixed(2)}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">Margin</div>
                          </div>
                        </div>
                      </div>
                    )}

                    <div>
                      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
                        <div className="text-sm font-semibold text-muted-foreground">
                          Positions {account.positions.length > 0 && `(${account.positions.length})`}
                        </div>
                        {account.positions.length > 0 && (
                          <div className="flex gap-2">
                            {[25, 50, 75, 100].map((pct) => (
                              <Button
                                key={pct}
                                onClick={() => closePosition(account.accountId, pct)}
                                size="sm"
                                className={`text-xs h-8 px-3 ${
                                  pct === 100
                                    ? "bg-red-600 hover:bg-red-700"
                                    : "bg-blue-600 hover:bg-blue-700"
                                }`}
                              >
                                {pct}%
                              </Button>
                            ))}
                          </div>
                        )}
                      </div>

                      {account.positions.length === 0 ? (
                        <div className="text-muted-foreground text-center py-8 text-sm italic">
                          No open positions
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {account.positions.map((pos, idx) => (
                            <div
                              key={idx}
                              className={`rounded-lg p-4 border-l-[3px] bg-muted/30 ${
                                pos.side === "LONG" ? "border-green-500" : "border-red-500"
                              }`}
                            >
                              <div className="flex justify-between items-start gap-4 mb-3">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-2">
                                    <Badge
                                      variant={pos.side === "LONG" ? "default" : "destructive"}
                                      className={pos.side === "LONG" ? "bg-green-600" : ""}
                                    >
                                      {pos.side}
                                    </Badge>
                                    <span className="text-sm text-muted-foreground font-medium">
                                      {pos.leverage}x
                                    </span>
                                  </div>
                                  <div className="text-sm text-muted-foreground mb-1">
                                    {pos.contracts.toFixed(2)} contracts
                                  </div>
                                  <div className="flex items-baseline gap-2">
                                    <span className="text-muted-foreground text-xs">Entry:</span>
                                    <span className="font-medium text-sm">${pos.avgPrice.toFixed(2)}</span>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div
                                    className={`text-xl font-bold mb-0.5 ${
                                      pos.unrealizedPnL >= 0 ? "text-green-600" : "text-red-600"
                                    }`}
                                  >
                                    {pos.unrealizedPnL >= 0 ? "+" : ""}$
                                    {pos.unrealizedPnL.toFixed(2)}
                                  </div>
                                  <div
                                    className={`text-xs font-medium mb-2 ${
                                      pos.unrealizedPnL >= 0 ? "text-green-600" : "text-red-600"
                                    }`}
                                  >
                                    ({pos.unrealizedPnLRatio.toFixed(2)}%)
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    Value: <span className="font-semibold text-foreground">${pos.notionalUsd.toFixed(2)}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
                        <div className="text-sm font-semibold text-muted-foreground">
                          Limit Orders{" "}
                          {(account.buyOrders.length + account.sellOrders.length > 0) &&
                            `(${account.buyOrders.length + account.sellOrders.length})`}
                        </div>
                        {(account.buyOrders.length > 0 || account.sellOrders.length > 0) && (
                          <Button
                            onClick={() => cancelAllOrders(account.accountId)}
                            size="sm"
                            variant="destructive"
                            className="text-xs h-8"
                          >
                            Cancel All
                          </Button>
                        )}
                      </div>

                      <div className="bg-muted/30 rounded-lg p-2">
                        {account.buyOrders.length === 0 && account.sellOrders.length === 0 ? (
                          <div className="text-muted-foreground text-center py-8 text-sm italic">
                            No pending orders
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5 px-2 pb-2 border-b border-muted-foreground/20">
                              <span className="text-xs font-semibold text-muted-foreground uppercase w-[85px]">Price</span>
                              <span className="text-xs font-semibold text-muted-foreground uppercase w-[55px] text-center">Size</span>
                              <span className="text-xs font-semibold text-muted-foreground uppercase w-[60px] text-center">Value</span>
                              <span className="text-xs font-semibold text-muted-foreground uppercase w-[100px] text-center">Distance</span>
                              <span className="w-8"></span>
                            </div>
                            <div className="space-y-1.5">
                            {account.sellOrders.map((order) => {
                              const distance = account.currentPrice
                                ? ((order.price - account.currentPrice) / account.currentPrice) *
                                  100
                                : 0;
                              return (
                                <div
                                  key={order.orderId}
                                  className="flex items-center gap-1.5 py-2.5 px-2 rounded bg-red-50 dark:bg-red-950/20 border-l-[3px] border-red-500 group hover:bg-red-100 dark:hover:bg-red-950/30 transition-colors"
                                >
                                  <span className="text-red-600 dark:text-red-400 font-mono font-semibold text-sm w-[85px]">
                                    ${order.price.toFixed(2)}
                                  </span>
                                  <span className="text-muted-foreground text-xs w-[55px] text-center">
                                    {order.size.toFixed(2)}
                                  </span>
                                  <span className="font-medium text-sm w-[60px] text-center">
                                    ${order.value.toFixed(0)}
                                  </span>
                                  <span className="text-muted-foreground text-xs w-[100px] text-center">
                                    {distance >= 0 ? "+" : ""}
                                    {distance.toFixed(2)}%
                                  </span>
                                  <Button
                                    onClick={() =>
                                      cancelOrder(account.accountId, order.orderId, order.instId)
                                    }
                                    size="sm"
                                    variant="ghost"
                                    className="opacity-0 group-hover:opacity-100 text-xs h-6 px-2 hover:bg-destructive hover:text-destructive-foreground w-8 shrink-0"
                                  >
                                    ✕
                                  </Button>
                                </div>
                              );
                            })}

                            {account.currentPrice && (
                              <div className="relative my-3">
                                <div className="border-t-2 border-dashed border-blue-500/50" />
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-3 py-1">
                                  <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400">
                                    ${account.currentPrice.toFixed(2)}
                                  </span>
                                </div>
                              </div>
                            )}

                            {account.buyOrders.map((order) => {
                              const distance = account.currentPrice
                                ? ((order.price - account.currentPrice) / account.currentPrice) *
                                  100
                                : 0;
                              return (
                                <div
                                  key={order.orderId}
                                  className="flex items-center gap-1.5 py-2.5 px-2 rounded bg-green-50 dark:bg-green-950/20 border-l-[3px] border-green-500 group hover:bg-green-100 dark:hover:bg-green-950/30 transition-colors"
                                >
                                  <span className="text-green-600 dark:text-green-400 font-mono font-semibold text-sm w-[85px]">
                                    ${order.price.toFixed(2)}
                                  </span>
                                  <span className="text-muted-foreground text-xs w-[55px] text-center">
                                    {order.size.toFixed(2)}
                                  </span>
                                  <span className="font-medium text-sm w-[60px] text-center">
                                    ${order.value.toFixed(0)}
                                  </span>
                                  <span className="text-muted-foreground text-xs w-[100px] text-center">
                                    {distance >= 0 ? "+" : ""}
                                    {distance.toFixed(2)}%
                                  </span>
                                  <Button
                                    onClick={() =>
                                      cancelOrder(account.accountId, order.orderId, order.instId)
                                    }
                                    size="sm"
                                    variant="ghost"
                                    className="opacity-0 group-hover:opacity-100 text-xs h-6 px-2 hover:bg-destructive hover:text-destructive-foreground w-8 shrink-0"
                                  >
                                    ✕
                                  </Button>
                                </div>
                              );
                            })}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))
          )}
        </div>

        <div className="text-center text-muted-foreground text-sm py-6 mt-8">
          Auto-refresh every 60 seconds
        </div>
      </div>
    </div>
  );
}
