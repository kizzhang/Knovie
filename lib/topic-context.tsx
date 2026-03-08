"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import type { Topic } from "./types";

interface TopicContextValue {
  topics: Topic[];
  selectedTopic: Topic | null;
  selectTopic: (topic: Topic | null) => void;
  refreshTopics: () => Promise<void>;
  loading: boolean;
  error: string | null;
}

const TopicContext = createContext<TopicContextValue | null>(null);

export function TopicProvider({ children }: { children: ReactNode }) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const selectedRef = useRef(selectedTopic);
  selectedRef.current = selectedTopic;

  const refreshTopics = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/topics");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Topic[] = await res.json();
      setTopics(data);

      const current = selectedRef.current;
      if (!current && data.length > 0) {
        setSelectedTopic(data[0]);
      } else if (current) {
        const updated = data.find((topic) => topic.id === current.id);
        if (updated) {
          setSelectedTopic(updated);
        } else {
          setSelectedTopic(data.length > 0 ? data[0] : null);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载主题失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshTopics();
  }, [refreshTopics]);

  return (
    <TopicContext value={{
      topics,
      selectedTopic,
      selectTopic: setSelectedTopic,
      refreshTopics,
      loading,
      error,
    }}>
      {children}
    </TopicContext>
  );
}

export function useTopic() {
  const ctx = useContext(TopicContext);
  if (!ctx) throw new Error("useTopic must be used within TopicProvider");
  return ctx;
}
