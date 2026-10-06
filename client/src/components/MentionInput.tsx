import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface MentionUser {
  id: string;
  name: string;
  role: string;
  username?: string;
}

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  "data-testid"?: string;
}

const MENTION_MARKER = "\u200B";

export function MentionInput({ 
  value, 
  onChange, 
  placeholder = "Escribe un comentario...",
  rows = 2,
  className,
  "data-testid": testId,
}: MentionInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [mentionSearch, setMentionSearch] = useState("");
  const [mentionStartPos, setMentionStartPos] = useState<number | null>(null);
  const [confirmedMentions, setConfirmedMentions] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: users = [] } = useQuery<MentionUser[]>({
    queryKey: ["/api/users-for-mentions"],
  });

  const filteredUsers = users.filter(user => {
    const searchLower = mentionSearch.toLowerCase().trim();
    if (!searchLower) return true;
    const nameLower = user.name.toLowerCase();
    const usernameLower = (user.username || "").toLowerCase();
    
    if (nameLower.includes(searchLower) || usernameLower.includes(searchLower)) {
      return true;
    }
    
    const searchWords = searchLower.split(/\s+/).filter(w => w.length > 0);
    if (searchWords.length > 1) {
      return searchWords.every(word => 
        nameLower.includes(word) || usernameLower.includes(word)
      );
    }
    
    return false;
  });

  useEffect(() => {
    if (value === "") {
      setConfirmedMentions(new Set());
    }
  }, [value]);

  const syncScroll = () => {
    if (inputRef.current && overlayRef.current) {
      overlayRef.current.scrollTop = inputRef.current.scrollTop;
      overlayRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursorPos = e.target.selectionStart;
    
    const textBeforeCursor = newValue.slice(0, cursorPos);
    const lastAtSymbol = textBeforeCursor.lastIndexOf("@");
    
    if (lastAtSymbol !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtSymbol + 1);
      const hasSpaceBeforeAt = lastAtSymbol === 0 || /[\s\u200B]/.test(newValue[lastAtSymbol - 1]);

      const cleanTextAfterAt = textAfterAt.replace(/\u200B/g, '');
      
      if (confirmedMentions.has(cleanTextAfterAt)) {
        setShowSuggestions(false);
        setMentionStartPos(null);
        onChange(newValue);
        return;
      }

      const hasNewline = /\n/.test(textAfterAt);
      const isReasonableLength = cleanTextAfterAt.length <= 50;
      
      if (hasSpaceBeforeAt && !hasNewline && isReasonableLength && cleanTextAfterAt.length > 0) {
        setShowSuggestions(true);
        setMentionSearch(cleanTextAfterAt);
        setMentionStartPos(lastAtSymbol);
        setSuggestionIndex(0);
      } else if (hasSpaceBeforeAt && cleanTextAfterAt.length === 0) {
        setShowSuggestions(true);
        setMentionSearch("");
        setMentionStartPos(lastAtSymbol);
        setSuggestionIndex(0);
      } else {
        setShowSuggestions(false);
        setMentionStartPos(null);
      }
    } else {
      setShowSuggestions(false);
      setMentionStartPos(null);
    }
    
    onChange(newValue);
  };

  const insertMention = (user: MentionUser) => {
    if (mentionStartPos === null) return;
    
    const cursorPos = inputRef.current?.selectionStart ?? value.length;
    const beforeMention = value.slice(0, mentionStartPos);
    const afterCursor = value.slice(cursorPos);
    const mentionText = `@${user.name}`;
    const newValue = `${beforeMention}${mentionText}${MENTION_MARKER} ${afterCursor}`;
    
    setConfirmedMentions(prev => new Set(prev).add(user.name));
    
    onChange(newValue);
    setShowSuggestions(false);
    setMentionSearch("");
    setMentionStartPos(null);
    
    setTimeout(() => {
      if (inputRef.current) {
        const newCursorPos = beforeMention.length + mentionText.length + 2;
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
        inputRef.current.focus();
      }
    }, 0);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!showSuggestions || filteredUsers.length === 0) return;
    
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSuggestionIndex(prev => 
        prev < filteredUsers.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSuggestionIndex(prev => 
        prev > 0 ? prev - 1 : filteredUsers.length - 1
      );
    } else if (e.key === "Enter" && showSuggestions) {
      e.preventDefault();
      insertMention(filteredUsers[suggestionIndex]);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current && 
        !containerRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (suggestionsRef.current && showSuggestions) {
      const selectedItem = suggestionsRef.current.children[suggestionIndex] as HTMLElement;
      if (selectedItem) {
        selectedItem.scrollIntoView({ block: "nearest" });
      }
    }
  }, [suggestionIndex, showSuggestions]);

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      carrier_rep: "Carrier Rep",
      carrier_lead: "Carrier Lead",
      carrier_manager: "Carrier Manager",
      sales_rep: "Sales Rep",
      sales_lead: "Sales Lead",
      sales_manager: "Sales Manager",
      pricing: "Pricing",
      superadmin: "Admin",
    };
    return labels[role] || role;
  };

  const renderOverlay = () => {
    if (!value) return null;
    
    const sortedUsers = [...users].sort((a, b) => b.name.length - a.name.length);
    const parts: { text: string; isMention: boolean }[] = [];
    let remaining = value;
    
    while (remaining.length > 0) {
      let earliestMatch: { index: number; name: string; fullMatch: string } | null = null;
      
      for (const user of sortedUsers) {
        const escapedName = user.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`@${escapedName}`, 'gi');
        const match = pattern.exec(remaining);
        if (match && (earliestMatch === null || match.index < earliestMatch.index)) {
          earliestMatch = { index: match.index, name: user.name, fullMatch: match[0] };
        }
      }
      
      if (earliestMatch) {
        if (earliestMatch.index > 0) {
          parts.push({ text: remaining.slice(0, earliestMatch.index), isMention: false });
        }
        parts.push({ text: earliestMatch.fullMatch, isMention: true });
        remaining = remaining.slice(earliestMatch.index + earliestMatch.fullMatch.length);
      } else {
        parts.push({ text: remaining, isMention: false });
        break;
      }
    }
    
    return parts.map((part, index) => {
      if (part.isMention) {
        return (
          <span key={index} className="bg-blue-500/20 text-blue-400 rounded px-0.5">
            {part.text}
          </span>
        );
      }
      return <span key={index} className="text-transparent">{part.text}</span>;
    });
  };

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <div 
          ref={overlayRef}
          className={cn(
            "absolute inset-0 pointer-events-none px-3 py-2 text-sm whitespace-pre-wrap break-words overflow-hidden",
            "rounded-md"
          )}
          aria-hidden="true"
        >
          {renderOverlay()}
        </div>
        <textarea
          ref={inputRef}
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onScroll={syncScroll}
          placeholder={placeholder}
          rows={rows}
          className={cn(
            "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm",
            "placeholder:text-muted-foreground focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background",
            "resize-y min-h-[60px]",
            className
          )}
          style={{ caretColor: 'white' }}
          data-testid={testId}
        />
      </div>
      
      {showSuggestions && filteredUsers.length > 0 && (
        <div 
          ref={suggestionsRef}
          className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto bg-popover border rounded-md shadow-lg"
          data-testid="mention-suggestions"
          onMouseDown={(e) => e.preventDefault()}
        >
          {filteredUsers.slice(0, 8).map((user, index) => (
            <div
              key={user.id}
              className={cn(
                "flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors",
                index === suggestionIndex 
                  ? "bg-accent text-accent-foreground" 
                  : "hover:bg-accent/50"
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                insertMention(user);
              }}
              data-testid={`mention-user-${user.id}`}
            >
              <Avatar className="h-6 w-6">
                <AvatarFallback className="text-xs bg-blue-500/15 text-blue-400">
                  {user.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{user.name}</div>
                <div className="text-xs text-muted-foreground">{getRoleLabel(user.role)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      
      {showSuggestions && filteredUsers.length === 0 && mentionSearch && (
        <div className="absolute z-50 mt-1 w-full bg-popover border rounded-md shadow-lg p-3 text-sm text-muted-foreground">
          No se encontraron usuarios
        </div>
      )}
    </div>
  );
}

export function getCleanText(text: string): string {
  return text.replace(/\u200B/g, '');
}

export function parseMentions(text: string, knownUsers?: { name: string }[]): string[] {
  const cleanText = getCleanText(text);
  if (knownUsers && knownUsers.length > 0) {
    const mentions: string[] = [];
    const sortedUsers = [...knownUsers].sort((a, b) => b.name.length - a.name.length);
    let remaining = cleanText;
    for (const user of sortedUsers) {
      const escapedName = user.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`@${escapedName}(?=[\\s,;.!?]|$)`, 'gi');
      if (pattern.test(remaining) && !mentions.includes(user.name)) {
        mentions.push(user.name);
        remaining = remaining.replace(pattern, '');
      }
    }
    return mentions;
  }

  const mentionRegex = /@([A-Za-záéíóúñÁÉÍÓÚÑ][A-Za-záéíóúñÁÉÍÓÚÑ ]*[A-Za-záéíóúñÁÉÍÓÚÑ])(?=[\s,;.!?]|$)/g;
  const mentions: string[] = [];
  let match;
  
  while ((match = mentionRegex.exec(cleanText)) !== null) {
    const mentionedName = match[1].trim();
    if (mentionedName && !mentions.includes(mentionedName)) {
      mentions.push(mentionedName);
    }
  }
  
  return mentions;
}

export function renderMentionText(text: string, knownUsers?: { name: string }[]) {
  const cleanText = getCleanText(text);
  if (knownUsers && knownUsers.length > 0) {
    const sortedUsers = [...knownUsers].sort((a, b) => b.name.length - a.name.length);
    const parts: { text: string; isMention: boolean }[] = [];
    let remaining = cleanText;
    
    while (remaining.length > 0) {
      let earliestMatch: { index: number; name: string; length: number } | null = null;
      
      for (const user of sortedUsers) {
        const escapedName = user.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`@${escapedName}(?=[\\s,;.!?]|$)`, 'gi');
        const match = pattern.exec(remaining);
        if (match && (earliestMatch === null || match.index < earliestMatch.index)) {
          earliestMatch = { index: match.index, name: user.name, length: match[0].length };
        }
      }
      
      if (earliestMatch) {
        if (earliestMatch.index > 0) {
          parts.push({ text: remaining.slice(0, earliestMatch.index), isMention: false });
        }
        parts.push({ text: `@${earliestMatch.name}`, isMention: true });
        remaining = remaining.slice(earliestMatch.index + earliestMatch.length);
      } else {
        parts.push({ text: remaining, isMention: false });
        break;
      }
    }
    
    return parts;
  }

  const mentionRegex = /@([A-Za-záéíóúñÁÉÍÓÚÑ][A-Za-záéíóúñÁÉÍÓÚÑ ]*[A-Za-záéíóúñÁÉÍÓÚÑ])/g;
  const parts: { text: string; isMention: boolean }[] = [];
  let lastIndex = 0;
  let match;
  
  while ((match = mentionRegex.exec(cleanText)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: cleanText.slice(lastIndex, match.index), isMention: false });
    }
    parts.push({ text: match[0], isMention: true });
    lastIndex = match.index + match[0].length;
  }
  
  if (lastIndex < cleanText.length) {
    parts.push({ text: cleanText.slice(lastIndex), isMention: false });
  }
  
  return parts;
}
