"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
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
  exchange?: string;
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
  publishedSymbols?: string[];
}

export default function HomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [data, setData] = useState<MonitorData | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedSymbols, setSelectedSymbols] = useState<Set<string>>(
    new Set()
  );
  const [selectedExchanges, setSelectedExchanges] = useState<Set<string>>(
    new Set()
  );
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isExchangeFilterOpen, setIsExchangeFilterOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(30);

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
      const interval = setInterval(fetchData, 600000);
      return () => clearInterval(interval);
    }
  }, [status]);

  const closePosition = async (accountId: string, symbol: string, percentage: number) => {
    if (!confirm(`Close ${percentage}% of ${symbol} positions?`)) return;

    try {
      const response = await fetch("/api/close-position", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, symbol, percentage }),
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

  const cancelOrder = async (
    accountId: string,
    orderId: string,
    instId: string
  ) => {
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

  // Helper function to get decimal places from a number
  const getDecimalPlaces = (num: number): number => {
    const str = num.toString();
    if (str.includes('.')) {
      return str.split('.')[1].length;
    }
    return 2; // Default to 2 decimal places
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

  const deleteGridLevel = async (
    accountId: string,
    symbol: string,
    side: "buy" | "sell",
    levelIndex: number
  ) => {
    try {
      const response = await fetch("/api/delete-grid-level", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, symbol, side, levelIndex }),
      });

      const result = await response.json();
      if (result.success) {
        fetchData();
      } else {
        alert("Error: " + (result.error || "Unknown error"));
      }
    } catch (error: any) {
      alert("Failed to delete grid level: " + error.message);
    }
  };

  const clearAllGridLevels = async (
    accountId: string,
    symbol: string,
    side?: "buy" | "sell"
  ) => {
    const sideText = side ? side.toUpperCase() : "ALL";
    if (!confirm(`Clear ALL ${sideText} grid levels for ${symbol}?`)) return;

    try {
      const response = await fetch("/api/delete-grid-level", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, symbol, side, clearAll: true }),
      });

      const result = await response.json();
      if (result.success) {
        alert(result.message);
        fetchData();
      } else {
        alert("Error: " + (result.error || "Unknown error"));
      }
    } catch (error: any) {
      alert("Failed to clear grid levels: " + error.message);
    }
  };

  // Get unique symbols from all accounts - memoized for performance
  const uniqueSymbols = useMemo(() => {
    return Array.from(
      new Set(data?.accounts.map((account) => account.symbol) || [])
    ).sort();
  }, [data?.accounts]);

  // Get unique exchanges from all accounts - memoized for performance
  const uniqueExchanges = useMemo(() => {
    return Array.from(
      new Set(
        data?.accounts
          .map((account) => account.exchange || "unknown")
          .filter((exchange) => exchange !== "unknown")
      ) || []
    ).sort();
  }, [data?.accounts]);

  // Toggle symbol selection
  const toggleSymbol = useCallback((symbol: string) => {
    setSelectedSymbols((prev) => {
      const newSelected = new Set(prev);
      if (newSelected.has(symbol)) {
        newSelected.delete(symbol);
      } else {
        newSelected.add(symbol);
      }
      return newSelected;
    });
    setCurrentPage(1); // Reset to first page when filter changes
  }, []);

  // Toggle exchange selection
  const toggleExchange = useCallback((exchange: string) => {
    setSelectedExchanges((prev) => {
      const newSelected = new Set(prev);
      if (newSelected.has(exchange)) {
        newSelected.delete(exchange);
      } else {
        newSelected.add(exchange);
      }
      return newSelected;
    });
    setCurrentPage(1); // Reset to first page when filter changes
  }, []);

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setSearchQuery("");
    setSelectedSymbols(new Set());
    setSelectedExchanges(new Set());
    setCurrentPage(1);
  }, []);

  // Filter accounts based on search query, selected symbols, and exchanges - memoized for performance
  const filteredAccounts = useMemo(() => {
    if (!data?.accounts) return [];

    return data.accounts.filter((account) => {
      // Filter by selected symbols
      if (selectedSymbols.size > 0 && !selectedSymbols.has(account.symbol)) {
        return false;
      }

      // Filter by selected exchanges
      if (
        selectedExchanges.size > 0 &&
        !selectedExchanges.has(account.exchange || "unknown")
      ) {
        return false;
      }

      // Filter by search query
      if (!searchQuery.trim()) return true;

      const query = searchQuery.toLowerCase();
      const matchesName = account.accountName.toLowerCase().includes(query);
      const matchesSymbol = account.symbol.toLowerCase().includes(query);
      const matchesExchange = account.exchange?.toLowerCase().includes(query);

      return matchesName || matchesSymbol || matchesExchange;
    });
  }, [data?.accounts, selectedSymbols, selectedExchanges, searchQuery]);

  // Paginated accounts - memoized for performance
  const paginatedAccounts = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filteredAccounts.slice(startIndex, endIndex);
  }, [filteredAccounts, currentPage, itemsPerPage]);

  const totalPages = useMemo(() => {
    return Math.ceil(filteredAccounts.length / itemsPerPage);
  }, [filteredAccounts.length, itemsPerPage]);

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
        <div className="flex flex-col gap-4 mb-6 pb-4 border-b">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl lg:text-3xl font-bold">
                Hypotomu Monitor
              </h1>
              <div className="text-xs lg:text-sm text-muted-foreground mt-1">
                {data
                  ? `Last updated: ${new Date(data.timestamp).toLocaleString()}`
                  : "Loading..."}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Button onClick={() => signOut()} variant="outline">
                Sign Out
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <input
                type="text"
                placeholder="Search by symbol or account name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 pl-10 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              )}
            </div>

            <div className="relative">
              <Button
                variant="outline"
                onClick={() => setIsExchangeFilterOpen(!isExchangeFilterOpen)}
                className="flex items-center gap-2"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                  />
                </svg>
                Exchanges
                {selectedExchanges.size > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {selectedExchanges.size}
                  </Badge>
                )}
              </Button>

              {isExchangeFilterOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsExchangeFilterOpen(false)}
                  />
                  <div className="absolute top-full mt-2 right-0 z-50 w-64 bg-background border border-border rounded-lg shadow-lg p-3 max-h-96 overflow-y-auto">
                    <div className="flex justify-between items-center mb-3 pb-2 border-b">
                      <span className="text-sm font-semibold">
                        Filter by Exchange
                      </span>
                      {selectedExchanges.size > 0 && (
                        <button
                          onClick={() => setSelectedExchanges(new Set())}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <div className="space-y-2">
                      {uniqueExchanges.map((exchange) => {
                        const count =
                          data?.accounts.filter(
                            (acc) => acc.exchange === exchange
                          ).length || 0;
                        return (
                          <label
                            key={exchange}
                            className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-2 rounded"
                          >
                            <input
                              type="checkbox"
                              checked={selectedExchanges.has(exchange)}
                              onChange={() => toggleExchange(exchange)}
                              className="h-4 w-4 rounded border-input"
                            />
                            <span className="flex-1 text-sm capitalize">
                              {exchange}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {count}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="relative">
              <Button
                variant="outline"
                onClick={() => setIsFilterOpen(!isFilterOpen)}
                className="flex items-center gap-2"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
                  />
                </svg>
                Symbols
                {selectedSymbols.size > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {selectedSymbols.size}
                  </Badge>
                )}
              </Button>

              {isFilterOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsFilterOpen(false)}
                  />
                  <div className="absolute top-full mt-2 right-0 z-50 w-64 bg-background border border-border rounded-lg shadow-lg p-3 max-h-96 overflow-y-auto">
                    <div className="flex justify-between items-center mb-3 pb-2 border-b">
                      <span className="text-sm font-semibold">
                        Filter by Symbol
                      </span>
                      {selectedSymbols.size > 0 && (
                        <button
                          onClick={() => setSelectedSymbols(new Set())}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <div className="space-y-2">
                      {uniqueSymbols.map((symbol) => {
                        const count =
                          data?.accounts.filter((acc) => acc.symbol === symbol)
                            .length || 0;
                        return (
                          <label
                            key={symbol}
                            className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 p-2 rounded"
                          >
                            <input
                              type="checkbox"
                              checked={selectedSymbols.has(symbol)}
                              onChange={() => toggleSymbol(symbol)}
                              className="h-4 w-4 rounded border-input"
                            />
                            <span className="flex-1 text-sm">{symbol}</span>
                            <span className="text-xs text-muted-foreground">
                              {count}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>

            {(searchQuery ||
              selectedSymbols.size > 0 ||
              selectedExchanges.size > 0) && (
              <div className="flex items-center gap-2">
                <div className="text-sm text-muted-foreground">
                  {filteredAccounts.length} result
                  {filteredAccounts.length !== 1 ? "s" : ""}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAllFilters}
                  className="text-xs h-8"
                >
                  Clear all
                </Button>
              </div>
            )}

            <div className="flex items-center gap-2 ml-auto">
              <label className="text-sm text-muted-foreground flex items-center gap-2">
                Items per page:
                <select
                  value={itemsPerPage}
                  onChange={(e) => {
                    setItemsPerPage(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="px-2 py-1 rounded border border-input bg-background text-sm"
                >
                  <option value={30}>30</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                </select>
              </label>
            </div>
          </div>

          {(selectedSymbols.size > 0 || selectedExchanges.size > 0) && (
            <div className="flex flex-wrap gap-2">
              {Array.from(selectedExchanges).map((exchange) => (
                <Badge
                  key={`exchange-${exchange}`}
                  variant="default"
                  className="flex items-center gap-1 pr-1 bg-blue-600"
                >
                  <svg
                    className="h-3 w-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                    />
                  </svg>
                  <span className="capitalize">{exchange}</span>
                  <button
                    onClick={() => toggleExchange(exchange)}
                    className="ml-1 hover:bg-muted rounded-full p-0.5"
                  >
                    <svg
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </Badge>
              ))}
              {Array.from(selectedSymbols).map((symbol) => (
                <Badge
                  key={`symbol-${symbol}`}
                  variant="secondary"
                  className="flex items-center gap-1 pr-1"
                >
                  {symbol}
                  <button
                    onClick={() => toggleSymbol(symbol)}
                    className="ml-1 hover:bg-muted rounded-full p-0.5"
                  >
                    <svg
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-lg mb-6">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {isInitialLoading ? (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          ) : filteredAccounts.length === 0 ? (
            <div className="col-span-full text-center py-16">
              <div className="text-muted-foreground text-lg mb-2">
                {searchQuery ? "No results found" : "No accounts available"}
              </div>
              {searchQuery && (
                <div className="text-sm text-muted-foreground">
                  Try adjusting your search query
                </div>
              )}
            </div>
          ) : (
            paginatedAccounts.map((account) => (
              <Card
                key={`${account.accountId}-${account.symbol}`}
                className="overflow-hidden"
              >
                <CardHeader className="pb-4">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg lg:text-xl truncate">
                        {account.accountName}
                      </CardTitle>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="text-sm lg:text-base font-semibold text-foreground">
                          {account.symbol}
                        </div>
                        {account.exchange && (
                          <Badge variant="secondary" className="text-xs">
                            {account.exchange}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0">
                      #{String(account.accountId).slice(0, 8)}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-6">
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
                              <div className="text-xs text-muted-foreground mb-1.5">
                                Equity
                              </div>
                              <div className="text-xl font-bold">
                                ${account.balance.equity.toFixed(2)}
                              </div>
                              {account.balance.equity24hChange !== null &&
                                account.balance.equity24hChange !==
                                  undefined && (
                                  <div
                                    className={`text-xs mt-1 font-medium ${
                                      account.balance.equity24hChange >= 0
                                        ? "text-green-600"
                                        : "text-red-600"
                                    }`}
                                  >
                                    24h:{" "}
                                    {account.balance.equity24hChange >= 0
                                      ? "+"
                                      : ""}
                                    $
                                    {account.balance.equity24hChange.toFixed(2)}{" "}
                                    (
                                    {account.balance.equity24hChangePercent?.toFixed(
                                      2
                                    )}
                                    %)
                                  </div>
                                )}
                            </div>
                            <div className="flex-1 min-w-[120px]">
                              <div className="text-xs text-muted-foreground mb-1.5">
                                Available
                              </div>
                              <div className="text-xl font-bold">
                                ${account.balance.availableBalance.toFixed(2)}
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                Balance
                              </div>
                            </div>
                            <div className="flex-1 min-w-[120px]">
                              <div className="text-xs text-muted-foreground mb-1.5">
                                In Use
                              </div>
                              <div className="text-xl font-bold">
                                ${account.balance.balanceInUse.toFixed(2)}
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                Margin
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      <div>
                        <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
                          <div className="text-sm font-semibold text-muted-foreground">
                            Positions{" "}
                            {account.positions.length > 0 &&
                              `(${account.positions.length})`}
                          </div>
                          {account.positions.length > 0 && (
                            <div className="flex gap-2">
                              {[10, 20, 40, 80, 100].map((pct) => (
                                <Button
                                  key={pct}
                                  onClick={() =>
                                    closePosition(account.accountId, account.symbol, pct)
                                  }
                                  size="sm"
                                  className={`text-xs h-8 px-3 ${
                                    pct === 100
                                      ? "bg-red-600 hover:bg-red-700"
                                      : "bg-blue-600 hover:bg-blue-700"
                                  }`}
                                >
                                  {pct === 100 ? "All" : `${pct}%`}
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
                                  pos.side === "LONG"
                                    ? "border-green-500"
                                    : "border-red-500"
                                }`}
                              >
                                <div className="flex justify-between items-start gap-4 mb-3">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-2">
                                      <Badge
                                        variant={
                                          pos.side === "LONG"
                                            ? "default"
                                            : "destructive"
                                        }
                                        className={
                                          pos.side === "LONG"
                                            ? "bg-green-600"
                                            : ""
                                        }
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
                                      <span className="text-muted-foreground text-xs">
                                        Entry:
                                      </span>
                                      <span className="font-medium text-sm">
                                        ${pos.avgPrice.toFixed(2)}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="text-right">
                                    <div
                                      className={`text-xl font-bold mb-0.5 ${
                                        pos.unrealizedPnL >= 0
                                          ? "text-green-600"
                                          : "text-red-600"
                                      }`}
                                    >
                                      {pos.unrealizedPnL >= 0 ? "+" : ""}$
                                      {pos.unrealizedPnL.toFixed(2)}
                                    </div>
                                    <div
                                      className={`text-xs font-medium mb-2 ${
                                        pos.unrealizedPnL >= 0
                                          ? "text-green-600"
                                          : "text-red-600"
                                      }`}
                                    >
                                      ({pos.unrealizedPnLRatio.toFixed(2)}%)
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      Value:{" "}
                                      <span className="font-semibold text-foreground">
                                        ${pos.notionalUsd.toFixed(2)}
                                      </span>
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
                            Grid Levels{" "}
                            {account.buyOrders.length +
                              account.sellOrders.length >
                              0 &&
                              `(${
                                account.buyOrders.length +
                                account.sellOrders.length
                              })`}
                          </div>
                          {(account.buyOrders.length > 0 ||
                            account.sellOrders.length > 0) && (
                            <Button
                              onClick={() =>
                                clearAllGridLevels(
                                  account.accountId,
                                  account.symbol
                                )
                              }
                              size="sm"
                              variant="destructive"
                              className="text-xs h-8"
                            >
                              Clear All
                            </Button>
                          )}
                        </div>

                        <div className="bg-muted/30 rounded-lg">
                          {account.buyOrders.length === 0 &&
                          account.sellOrders.length === 0 ? (
                            <div className="text-muted-foreground text-center py-8 text-sm italic">
                              No pending grid levels
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex items-center gap-1.5 px-2 pb-2 border-b border-muted-foreground/20">
                                <span className="text-xs font-semibold text-muted-foreground uppercase flex-[1.3] min-w-0">
                                  Price
                                </span>
                                <span className="text-xs font-semibold text-muted-foreground uppercase flex-1 min-w-0 text-center">
                                  Size
                                </span>
                                <span className="text-xs font-semibold text-muted-foreground uppercase flex-1 min-w-0 text-center">
                                  Value
                                </span>
                                <span className="text-xs font-semibold text-muted-foreground uppercase flex-1 min-w-0 text-center">
                                  Distance
                                </span>
                                <span className="w-8"></span>
                              </div>
                              <div className="space-y-1.5">
                                {account.sellOrders
                                  .map((order) => ({
                                    ...order,
                                    distance: account.currentPrice
                                      ? ((order.price - account.currentPrice) /
                                          account.currentPrice) *
                                        100
                                      : 0,
                                  }))
                                  .sort((a, b) => b.price - a.price)
                                  .map((order, idx) => {
                                    const levelIndex = parseInt(order.orderId.split('_')[2] || '0');
                                    const decimals = account.currentPrice ? getDecimalPlaces(account.currentPrice) : 2;
                                    return (
                                      <div
                                        key={order.orderId}
                                        className="flex items-center gap-1.5 py-2.5 px-2 rounded bg-red-50 dark:bg-red-950/20 border-l-[3px] border-red-500 group hover:bg-red-100 dark:hover:bg-red-950/30 transition-colors"
                                      >
                                        <span className="text-red-600 dark:text-red-400 font-mono font-semibold text-sm flex-[1.3] min-w-0 truncate">
                                          ${(order.price || 0).toFixed(decimals)}
                                        </span>
                                        <span className="text-muted-foreground text-xs flex-1 min-w-0 text-center">
                                          {(order.size || 0).toFixed(2)}
                                        </span>
                                        <span className="font-medium text-sm flex-1 min-w-0 text-center">
                                          ${(order.value || 0).toFixed(2)}
                                        </span>
                                        <span className="text-muted-foreground text-xs flex-1 min-w-0 text-center">
                                          {order.distance >= 0 ? "+" : ""}
                                          {order.distance.toFixed(2)}%
                                        </span>
                                        <Button
                                          onClick={() =>
                                            deleteGridLevel(
                                              account.accountId,
                                              account.symbol,
                                              "sell",
                                              levelIndex
                                            )
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
                                        ${account.currentPrice.toFixed(getDecimalPlaces(account.currentPrice))}
                                      </span>
                                    </div>
                                  </div>
                                )}

                                {account.buyOrders
                                  .map((order) => ({
                                    ...order,
                                    distance: account.currentPrice
                                      ? ((order.price - account.currentPrice) /
                                          account.currentPrice) *
                                        100
                                      : 0,
                                  }))
                                  .sort((a, b) => b.price - a.price)
                                  .map((order, idx) => {
                                    const levelIndex = parseInt(order.orderId.split('_')[2] || '0');
                                    const decimals = account.currentPrice ? getDecimalPlaces(account.currentPrice) : 2;
                                    return (
                                      <div
                                        key={order.orderId}
                                        className="flex items-center gap-1.5 py-2.5 px-2 rounded bg-green-50 dark:bg-green-950/20 border-l-[3px] border-green-500 group hover:bg-green-100 dark:hover:bg-green-950/30 transition-colors"
                                      >
                                        <span className="text-green-600 dark:text-green-400 font-mono font-semibold text-sm flex-[1.3] min-w-0 truncate">
                                          ${(order.price || 0).toFixed(decimals)}
                                        </span>
                                        <span className="text-muted-foreground text-xs flex-1 min-w-0 text-center">
                                          {(order.size || 0).toFixed(2)}
                                        </span>
                                        <span className="font-medium text-sm flex-1 min-w-0 text-center">
                                          ${(order.value || 0).toFixed(2)}
                                        </span>
                                        <span className="text-muted-foreground text-xs flex-1 min-w-0 text-center">
                                          {order.distance >= 0 ? "+" : ""}
                                          {order.distance.toFixed(2)}%
                                        </span>
                                        <Button
                                          onClick={() =>
                                            deleteGridLevel(
                                              account.accountId,
                                              account.symbol,
                                              "buy",
                                              levelIndex
                                            )
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

        {/* Pagination Controls */}
        {!isInitialLoading && filteredAccounts.length > 0 && totalPages > 1 && (
          <div className="flex justify-center items-center gap-4 mt-8">
            <Button
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              variant="outline"
              size="sm"
            >
              First
            </Button>
            <Button
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              variant="outline"
              size="sm"
            >
              Previous
            </Button>
            <div className="text-sm text-muted-foreground px-4">
              Page {currentPage} of {totalPages} ({filteredAccounts.length} total)
            </div>
            <Button
              onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              variant="outline"
              size="sm"
            >
              Next
            </Button>
            <Button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
              variant="outline"
              size="sm"
            >
              Last
            </Button>
          </div>
        )}

        <div className="text-center text-muted-foreground text-sm py-6 mt-8">
          Auto-refresh every 10 minutes
        </div>
      </div>
    </div>
  );
}
