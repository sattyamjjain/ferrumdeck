"use client";

import * as React from "react";
import {
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  Edit2,
  MoreHorizontal,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface SavedView<TFilters = Record<string, unknown>> {
  id: string;
  name: string;
  filters: TFilters;
  isDefault?: boolean;
  createdAt: string;
  updatedAt?: string;
}

interface SavedViewsProps<TFilters = Record<string, unknown>> {
  views: SavedView<TFilters>[];
  activeViewId?: string | null;
  currentFilters: TFilters;
  onViewSelect: (view: SavedView<TFilters>) => void;
  onViewCreate: (name: string, filters: TFilters) => void;
  onViewUpdate: (id: string, name: string) => void;
  onViewDelete: (id: string) => void;
  onSetDefault?: (id: string) => void;
  hasUnsavedChanges?: boolean;
  disabled?: boolean;
  className?: string;
}

export function SavedViews<TFilters = Record<string, unknown>>({
  views,
  activeViewId,
  currentFilters,
  onViewSelect,
  onViewCreate,
  onViewUpdate,
  onViewDelete,
  onSetDefault,
  hasUnsavedChanges = false,
  disabled = false,
  className,
}: SavedViewsProps<TFilters>) {
  const [open, setOpen] = React.useState(false);
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [selectedView, setSelectedView] = React.useState<SavedView<TFilters> | null>(null);
  const [viewName, setViewName] = React.useState("");

  const activeView = views.find((v) => v.id === activeViewId);
  const defaultView = views.find((v) => v.isDefault);

  const handleCreate = () => {
    if (viewName.trim()) {
      onViewCreate(viewName.trim(), currentFilters);
      setViewName("");
      setCreateDialogOpen(false);
    }
  };

  const handleRename = () => {
    if (selectedView && viewName.trim()) {
      onViewUpdate(selectedView.id, viewName.trim());
      setViewName("");
      setRenameDialogOpen(false);
      setSelectedView(null);
    }
  };

  const handleDelete = () => {
    if (selectedView) {
      onViewDelete(selectedView.id);
      setDeleteDialogOpen(false);
      setSelectedView(null);
    }
  };

  const openRenameDialog = (view: SavedView<TFilters>) => {
    setSelectedView(view);
    setViewName(view.name);
    setRenameDialogOpen(true);
    setOpen(false);
  };

  const openDeleteDialog = (view: SavedView<TFilters>) => {
    setSelectedView(view);
    setDeleteDialogOpen(true);
    setOpen(false);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            disabled={disabled}
            className={cn(
              "h-9 min-w-[120px] justify-between gap-2",
              "bg-background-secondary border-border/50",
              "hover:bg-background-tertiary hover:border-border",
              "data-[state=open]:border-accent-blue/50 data-[state=open]:bg-background",
              className
            )}
          >
            <span className="flex items-center gap-2 text-sm">
              <Bookmark className="h-4 w-4 text-muted-foreground" />
              {activeView ? (
                <span className="flex items-center gap-1">
                  <span className="font-medium">{activeView.name}</span>
                  {hasUnsavedChanges && (
                    <span className="text-accent-yellow text-xs">*</span>
                  )}
                </span>
              ) : (
                <span className="text-muted-foreground font-normal">
                  Saved Views
                </span>
              )}
            </span>
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0" align="start">
          <div className="p-2 border-b border-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCreateDialogOpen(true);
                setOpen(false);
              }}
              className="w-full justify-start gap-2 h-8 text-sm"
            >
              <Plus className="h-4 w-4" />
              Save current view
            </Button>
          </div>

          {views.length > 0 ? (
            <ScrollArea className="max-h-[240px]">
              <div className="p-1">
                {views.map((view) => {
                  const isActive = view.id === activeViewId;
                  return (
                    <div
                      key={view.id}
                      className={cn(
                        "flex items-center gap-2 px-2 py-1.5 rounded-md group transition-colors",
                        isActive
                          ? "bg-accent-blue/10"
                          : "hover:bg-background-tertiary"
                      )}
                    >
                      <button
                        onClick={() => {
                          onViewSelect(view);
                          setOpen(false);
                        }}
                        className="flex-1 flex items-center gap-2 text-left min-w-0"
                      >
                        {isActive ? (
                          <BookmarkCheck className="h-4 w-4 text-accent-blue shrink-0" />
                        ) : (
                          <Bookmark className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <span
                          className={cn(
                            "text-sm truncate",
                            isActive ? "text-accent-blue font-medium" : ""
                          )}
                        >
                          {view.name}
                        </span>
                        {view.isDefault && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] h-4 px-1 bg-accent-yellow/15 text-accent-yellow border-accent-yellow/30"
                          >
                            Default
                          </Badge>
                        )}
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className={cn(
                              "p-1 rounded-sm transition-opacity",
                              "opacity-0 group-hover:opacity-100",
                              "hover:bg-foreground/10"
                            )}
                          >
                            <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-[160px]">
                          <DropdownMenuItem onClick={() => openRenameDialog(view)}>
                            <Edit2 className="h-4 w-4 mr-2" />
                            Rename
                          </DropdownMenuItem>
                          {onSetDefault && !view.isDefault && (
                            <DropdownMenuItem
                              onClick={() => onSetDefault(view.id)}
                            >
                              <Star className="h-4 w-4 mr-2" />
                              Set as default
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => openDeleteDialog(view)}
                            variant="destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          ) : (
            <div className="p-4 text-center">
              <p className="text-sm text-muted-foreground">No saved views yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Create a view to save your current filters
              </p>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Create View Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Save View</DialogTitle>
            <DialogDescription>
              Save the current filter configuration as a named view for quick access.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="view-name">View name</Label>
              <Input
                id="view-name"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                placeholder="e.g., Failed runs this week"
                className="bg-background-secondary"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleCreate();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateDialogOpen(false);
                setViewName("");
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!viewName.trim()}>
              Save View
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename View Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Rename View</DialogTitle>
            <DialogDescription>
              Enter a new name for this view.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="rename-view-name">View name</Label>
              <Input
                id="rename-view-name"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                className="bg-background-secondary"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleRename();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRenameDialogOpen(false);
                setViewName("");
                setSelectedView(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={!viewName.trim()}>
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete View Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Delete View</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{selectedView?.name}&quot;? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false);
                setSelectedView(null);
              }}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Quick access chips for favorite/default views
interface SavedViewChipsProps<TFilters = Record<string, unknown>> {
  views: SavedView<TFilters>[];
  activeViewId?: string | null;
  onViewSelect: (view: SavedView<TFilters>) => void;
  maxVisible?: number;
  className?: string;
}

export function SavedViewChips<TFilters = Record<string, unknown>>({
  views,
  activeViewId,
  onViewSelect,
  maxVisible = 4,
  className,
}: SavedViewChipsProps<TFilters>) {
  if (views.length === 0) return null;

  const visibleViews = views.slice(0, maxVisible);
  const hiddenCount = views.length - maxVisible;

  return (
    <div className={cn("flex items-center gap-1 flex-wrap", className)}>
      {visibleViews.map((view) => {
        const isActive = view.id === activeViewId;
        return (
          <button
            key={view.id}
            onClick={() => onViewSelect(view)}
            className={cn(
              "inline-flex items-center gap-1.5 h-6 px-2 rounded-md text-xs font-medium transition-all",
              isActive
                ? "bg-accent-blue/15 text-accent-blue border border-accent-blue/30"
                : "bg-background-tertiary text-muted-foreground border border-border/30 hover:text-foreground hover:border-border"
            )}
          >
            {view.isDefault && <Star className="h-3 w-3" />}
            {view.name}
          </button>
        );
      })}
      {hiddenCount > 0 && (
        <span className="text-xs text-muted-foreground">
          +{hiddenCount} more
        </span>
      )}
    </div>
  );
}
