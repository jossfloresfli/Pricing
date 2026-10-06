import { useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PricingCard, type PricingRequest } from "./PricingCard";
import type { PricingStatus } from "./StatusBadge";
import { cn } from "@/lib/utils";

interface KanbanColumn {
  id: PricingStatus;
  title: string;
  color: string;
}

const columns: KanbanColumn[] = [
  { id: "pendiente", title: "Pendiente de Info", color: "bg-amber-500" },
  { id: "por_revisar", title: "Por Revisar", color: "bg-blue-500" },
  { id: "cotizando", title: "Cotizando", color: "bg-purple-500" },
  { id: "enviado", title: "Enviado", color: "bg-cyan-500" },
  { id: "cotizacion_enviada", title: "Cotización Enviada", color: "bg-teal-500" },
  { id: "feedback", title: "Feedback", color: "bg-orange-500" },
  { id: "ganada", title: "Ganada", color: "bg-emerald-500" },
  { id: "perdida", title: "Perdida", color: "bg-gray-500" },
  { id: "rechazada", title: "Rechazada", color: "bg-red-500" },
];

interface KanbanBoardProps {
  requests: PricingRequest[];
  onViewDetail?: (id: string, tab?: string) => void;
  onStatusChange?: (requestId: string, newStatus: PricingStatus) => void;
  canDropToStatus?: (status: PricingStatus) => boolean;
  layout?: "horizontal" | "vertical";
}

export function KanbanBoard({ requests, onViewDetail, onStatusChange, canDropToStatus, layout = "horizontal" }: KanbanBoardProps) {
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<PricingStatus | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Prevent browser back/forward navigation on horizontal scroll (Mac trackpad gesture)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      // If there's horizontal scroll intent
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const { scrollLeft, scrollWidth, clientWidth } = container;
        const maxScroll = scrollWidth - clientWidth;
        
        // Prevent default only when at edges to stop browser navigation
        if ((e.deltaX < 0 && scrollLeft > 0) || 
            (e.deltaX > 0 && scrollLeft < maxScroll)) {
          // Allow normal scrolling within bounds
        } else if (maxScroll > 0) {
          // At edge but container is scrollable - prevent navigation
          e.preventDefault();
        }
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  const getRequestsByStatus = (status: PricingStatus) =>
    requests.filter((r) => r.status === status).sort((a, b) => {
      const urgA = a.urgencia || 0;
      const urgB = b.urgencia || 0;
      if (urgB !== urgA) return urgB - urgA;
      const parsedA = a.fechaEntrega ? new Date(a.fechaEntrega).getTime() : Infinity;
      const parsedB = b.fechaEntrega ? new Date(b.fechaEntrega).getTime() : Infinity;
      const dateA = Number.isNaN(parsedA) ? Infinity : parsedA;
      const dateB = Number.isNaN(parsedB) ? Infinity : parsedB;
      return dateA - dateB;
    });

  const handleDragStart = (e: React.DragEvent, requestId: string) => {
    setDraggedItem(requestId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", requestId);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverColumn(null);
  };

  const handleDragOver = (e: React.DragEvent, columnId: PricingStatus) => {
    if (canDropToStatus && !canDropToStatus(columnId)) {
      e.dataTransfer.dropEffect = "none";
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(columnId);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = (e: React.DragEvent, targetStatus: PricingStatus) => {
    e.preventDefault();
    const requestId = e.dataTransfer.getData("text/plain");
    
    if (canDropToStatus && !canDropToStatus(targetStatus)) {
      setDraggedItem(null);
      setDragOverColumn(null);
      return;
    }

    if (requestId && onStatusChange) {
      const request = requests.find(r => r.id === requestId);
      if (request && request.status !== targetStatus) {
        onStatusChange(requestId, targetStatus);
      }
    }
    
    setDraggedItem(null);
    setDragOverColumn(null);
  };

  if (layout === "vertical") {
    return (
      <div 
        className="space-y-6 pb-4" 
        data-testid="kanban-board-vertical"
      >
        {columns.map((column) => {
          const columnRequests = getRequestsByStatus(column.id);
          const isDropTarget = dragOverColumn === column.id;
          
          return (
            <div 
              key={column.id}
              id={`column-${column.id}`}
              onDragOver={(e) => handleDragOver(e, column.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, column.id)}
            >
              <Card className={cn(
                "transition-all duration-200",
                isDropTarget && "ring-2 ring-primary ring-offset-2"
              )}>
                <CardHeader className="pb-3 px-4">
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${column.color}`} />
                    <CardTitle className="text-base font-semibold">{column.title}</CardTitle>
                    <Badge variant="secondary" className="ml-2 text-sm">
                      {columnRequests.length}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className={cn(
                    "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 min-h-[80px] rounded-md transition-colors p-2",
                    isDropTarget && "bg-primary/5"
                  )}>
                    {columnRequests.length === 0 ? (
                      <div className={cn(
                        "col-span-full text-center py-6 text-muted-foreground text-sm",
                        isDropTarget && "text-primary font-medium"
                      )}>
                        {isDropTarget ? "Soltar aquí" : "Sin cotizaciones en este estatus"}
                      </div>
                    ) : (
                      columnRequests.map((request) => (
                        <div
                          key={request.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, request.id)}
                          onDragEnd={handleDragEnd}
                          className={cn(
                            "cursor-grab active:cursor-grabbing transition-opacity",
                            draggedItem === request.id && "opacity-50"
                          )}
                        >
                          <PricingCard
                            request={request}
                            onViewDetail={onViewDetail}
                          />
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div 
      ref={scrollContainerRef}
      className="flex gap-4 overflow-x-auto pb-4" 
      data-testid="kanban-board"
    >
      {columns.map((column) => {
        const columnRequests = getRequestsByStatus(column.id);
        const isDropTarget = dragOverColumn === column.id;
        
        return (
          <div 
            key={column.id}
            id={`column-${column.id}`}
            className="flex-shrink-0 min-w-[320px] w-[340px]"
            onDragOver={(e) => handleDragOver(e, column.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, column.id)}
          >
            <Card className={cn(
              "h-full transition-all duration-200",
              isDropTarget && "ring-2 ring-primary ring-offset-2"
            )}>
              <CardHeader className="pb-3 px-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${column.color}`} />
                  <CardTitle className="text-sm font-semibold">{column.title}</CardTitle>
                  <Badge variant="secondary" className="ml-auto text-xs">
                    {columnRequests.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="p-2 pt-0">
                <ScrollArea className="h-[calc(100vh-280px)]">
                  <div className={cn(
                    "space-y-3 pr-2 min-h-[100px] rounded-md transition-colors",
                    isDropTarget && "bg-primary/5"
                  )}>
                    {columnRequests.length === 0 ? (
                      <div className={cn(
                        "text-center py-8 text-muted-foreground text-sm",
                        isDropTarget && "text-primary font-medium"
                      )}>
                        {isDropTarget ? "Soltar aquí" : "Sin cotizaciones"}
                      </div>
                    ) : (
                      columnRequests.map((request) => (
                        <div
                          key={request.id}
                          draggable
                          onDragStart={(e) => handleDragStart(e, request.id)}
                          onDragEnd={handleDragEnd}
                          className={cn(
                            "cursor-grab active:cursor-grabbing transition-opacity",
                            draggedItem === request.id && "opacity-50"
                          )}
                        >
                          <PricingCard
                            request={request}
                            onViewDetail={onViewDetail}
                          />
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        );
      })}
    </div>
  );
}
