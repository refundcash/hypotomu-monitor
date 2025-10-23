import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function SkeletonCard() {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <div className="flex justify-between items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="h-6 bg-muted rounded animate-pulse w-32 mb-2" />
            <div className="h-4 bg-muted rounded animate-pulse w-24" />
          </div>
          <div className="h-6 bg-muted rounded animate-pulse w-16" />
        </div>
      </CardHeader>

      <CardContent className="pt-6 space-y-6">
        {/* Balance Skeleton */}
        <div className="bg-muted/50 rounded-lg p-4 border">
          <div className="flex flex-wrap gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex-1 min-w-[120px]">
                <div className="h-3 bg-muted rounded animate-pulse w-16 mb-2" />
                <div className="h-7 bg-muted rounded animate-pulse w-24 mb-1" />
                <div className="h-3 bg-muted rounded animate-pulse w-12" />
              </div>
            ))}
          </div>
        </div>

        {/* Positions Skeleton */}
        <div>
          <div className="flex justify-between items-center gap-3 mb-4">
            <div className="h-4 bg-muted rounded animate-pulse w-24" />
            <div className="flex gap-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-8 w-12 bg-muted rounded animate-pulse" />
              ))}
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-lg p-4 border-l-[3px] border-muted bg-muted/30">
              <div className="flex justify-between items-start gap-4 mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-6 w-16 bg-muted rounded animate-pulse" />
                    <div className="h-4 w-8 bg-muted rounded animate-pulse" />
                  </div>
                  <div className="h-4 bg-muted rounded animate-pulse w-24 mb-1" />
                  <div className="h-4 bg-muted rounded animate-pulse w-20" />
                </div>
                <div className="text-right">
                  <div className="h-6 bg-muted rounded animate-pulse w-20 mb-1" />
                  <div className="h-4 bg-muted rounded animate-pulse w-16 mb-2" />
                  <div className="h-3 bg-muted rounded animate-pulse w-24" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Limit Orders Skeleton */}
        <div>
          <div className="flex justify-between items-center gap-3 mb-4">
            <div className="h-4 bg-muted rounded animate-pulse w-28" />
            <div className="h-8 w-24 bg-muted rounded animate-pulse" />
          </div>
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-muted rounded animate-pulse" />
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
