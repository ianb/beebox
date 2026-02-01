/**
 * Main App component for Callback Box frontend.
 */

import { useState, useEffect, useCallback } from "react";
import { StatusBar } from "./components/StatusBar";
import { CardList } from "./components/CardList";
import { CardView } from "./components/CardView";
import { QuestionForm } from "./components/QuestionForm";
import { ActivityLog } from "./components/ActivityLog";
import { NewMemo, buildCreateCommandLabel, type MemoCommandArgs } from "./components/NewMemo";
import { ProcessNewsForm, buildProcessNewsLabel, type ProcessNewsArgs } from "./components/ProcessNewsForm";
import { CommandRunner } from "./components/CommandRunner";
import { useSSE } from "./hooks/useSSE";
import {
  getInbox,
  getQuestions,
  getCommands,
  type CardInfo,
} from "./api";

type Tab = "inbox" | "questions" | "commands" | "activity";

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("questions");
  const [inbox, setInbox] = useState<CardInfo[]>([]);
  const [questions, setQuestions] = useState<CardInfo[]>([]);
  const [commands, setCommands] = useState<CardInfo[]>([]);
  const [selectedCard, setSelectedCard] = useState<CardInfo | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showCreateMemo, setShowCreateMemo] = useState(false);
  const [showWakeup, setShowWakeup] = useState(false);
  const [showPull, setShowPull] = useState(false);
  const [showProcessNews, setShowProcessNews] = useState(false);
  const [createMemoArgs, setCreateMemoArgs] = useState<MemoCommandArgs | null>(null);
  const [processNewsArgs, setProcessNewsArgs] = useState<ProcessNewsArgs | null>(null);

  // SSE connection for live updates
  const { connected } = useSSE("/api/events", {
    onEvent: (event) => {
      console.log("SSE event:", event);
      // Refresh data on relevant events
      if (
        event.event === "file-change" ||
        event.event === "question-answered" ||
        event.event === "card-created" ||
        event.event === "wakeup-complete"
      ) {
        refresh();
      }
    },
  });

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      const [inboxData, questionsData, commandsData] = await Promise.all([
        getInbox(),
        getQuestions(),
        getCommands(),
      ]);
      setInbox(inboxData.items);
      setQuestions(questionsData.items);
      setCommands(commandsData.items);
    } catch (err) {
      console.error("Failed to fetch data:", err);
    }
  }, []);

  const refresh = useCallback(() => {
    fetchData();
    setRefreshKey((k) => k + 1);
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle wakeup/pull complete
  const handleCommandComplete = () => {
    refresh();
  };

  // Handle question answered
  const handleQuestionAnswered = () => {
    setSelectedCard(null);
    refresh();
  };

  // Handle memo form submitted - transition to showing command runner
  const handleMemoSubmit = (args: MemoCommandArgs) => {
    setCreateMemoArgs(args);
  };

  // Handle process-news form submitted
  const handleProcessNewsSubmit = (args: ProcessNewsArgs) => {
    setProcessNewsArgs(args);
  };

  // Handle create command complete
  const handleCreateComplete = () => {
    refresh();
  };

  // Close create memo view
  const handleCreateClose = () => {
    setShowCreateMemo(false);
    setCreateMemoArgs(null);
    setActiveTab("inbox");
    refresh();
  };

  // Get current tab items
  const getTabItems = () => {
    switch (activeTab) {
      case "inbox":
        return inbox;
      case "questions":
        return questions;
      case "commands":
        return commands;
      default:
        return [];
    }
  };

  // Check if selected card is a pending question
  const selectedQuestion =
    selectedCard?.status === "pending" && selectedCard?.type === "question"
      ? selectedCard
      : null;

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Status bar */}
      <StatusBar connected={connected} onRefresh={refresh} />

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        <div className="w-80 bg-white border-r flex flex-col min-h-0">
          {/* Tabs */}
          <div className="flex border-b">
            {(["inbox", "questions", "commands", "activity"] as Tab[]).map((tab) => {
              const labels: Record<Tab, string> = {
                inbox: "Inbox",
                questions: "Ask",
                commands: "Cmd",
                activity: "Log",
              };
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 px-2 py-3 text-sm font-medium transition-colors ${
                    activeTab === tab
                      ? "text-blue-600 border-b-2 border-blue-600"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {labels[tab]}
                  {tab === "questions" && questions.filter((q) => q.status === "pending").length > 0 && (
                    <span className="ml-1 bg-yellow-100 text-yellow-800 text-xs px-1.5 rounded">
                      {questions.filter((q) => q.status === "pending").length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-auto min-h-0">
            {activeTab === "activity" ? (
              <ActivityLog refreshKey={refreshKey} />
            ) : (
              <CardList
                items={getTabItems()}
                onSelect={(card) => {
                  setSelectedCard(card);
                  setShowCreateMemo(false);
                  setShowWakeup(false);
                  setShowPull(false);
                  setShowProcessNews(false);
                  setCreateMemoArgs(null);
                  setProcessNewsArgs(null);
                }}
                selectedPath={selectedCard?.path}
                emptyMessage={`No ${activeTab}`}
              />
            )}
          </div>

          {/* Actions */}
          <div className="border-t p-4 space-y-2 flex-shrink-0">
            <button
              onClick={() => {
                setShowCreateMemo(true);
                setCreateMemoArgs(null);
                setShowWakeup(false);
                setShowPull(false);
                setShowProcessNews(false);
                setSelectedCard(null);
              }}
              className="btn btn-success w-full"
            >
              + New Memo
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowPull(true);
                  setShowWakeup(false);
                  setShowCreateMemo(false);
                  setShowProcessNews(false);
                  setSelectedCard(null);
                }}
                className="btn btn-secondary flex-1 font-mono text-sm"
              >
                cb pull
              </button>
              <button
                onClick={() => {
                  setShowWakeup(true);
                  setShowCreateMemo(false);
                  setShowPull(false);
                  setShowProcessNews(false);
                  setSelectedCard(null);
                }}
                className="btn btn-secondary flex-1 font-mono text-sm"
              >
                cb wakeup
              </button>
            </div>
            {/* Show process-news button if there are any news items to process */}
            {(() => {
              const newsItems = inbox.filter((i) => i.type === "news-item");
              const newCount = newsItems.filter((i) => i.status === "new").length;
              const interestingCount = newsItems.filter((i) => i.status === "interesting").length;
              const fetchedCount = newsItems.filter((i) => i.status === "fetched").length;
              const totalProcessable = newCount + interestingCount + fetchedCount;
              if (totalProcessable === 0) return null;
              return (
                <button
                  onClick={() => {
                    setShowProcessNews(true);
                    setProcessNewsArgs(null);
                    setShowWakeup(false);
                    setShowCreateMemo(false);
                    setShowPull(false);
                    setSelectedCard(null);
                  }}
                  className="btn btn-primary w-full font-mono text-sm"
                >
                  cb process-news
                  {newCount > 0 && (
                    <span className="ml-2 bg-blue-200 text-blue-800 text-xs px-1.5 rounded">
                      {newCount} new
                    </span>
                  )}
                  {interestingCount > 0 && (
                    <span className="ml-1 bg-yellow-200 text-yellow-800 text-xs px-1.5 rounded">
                      {interestingCount} ready
                    </span>
                  )}
                </button>
              );
            })()}
          </div>
        </div>

        {/* Main panel */}
        <div className="flex-1 bg-gray-50 overflow-auto">
          {showProcessNews && processNewsArgs ? (
            <div className="p-4 h-full flex flex-col max-w-3xl">
              <CommandRunner
                command="process-news"
                args={processNewsArgs as unknown as Record<string, unknown>}
                label={buildProcessNewsLabel(processNewsArgs)}
                onComplete={handleCommandComplete}
                onClose={() => {
                  setShowProcessNews(false);
                  setProcessNewsArgs(null);
                }}
                autoRun
                className="flex-1"
              />
            </div>
          ) : showProcessNews ? (
            <div className="p-4 h-full">
              <ProcessNewsForm
                onSubmit={handleProcessNewsSubmit}
                onClose={() => setShowProcessNews(false)}
                newCount={inbox.filter((i) => i.type === "news-item" && i.status === "new").length}
                interestingCount={inbox.filter((i) => i.type === "news-item" && i.status === "interesting").length}
                fetchedCount={inbox.filter((i) => i.type === "news-item" && i.status === "fetched").length}
              />
            </div>
          ) : showPull ? (
            <div className="p-4 h-full flex flex-col max-w-3xl">
              <CommandRunner
                command="pull"
                onComplete={handleCommandComplete}
                onClose={() => setShowPull(false)}
                autoRun
                className="flex-1"
              />
            </div>
          ) : showWakeup ? (
            <div className="p-4 h-full flex flex-col max-w-3xl">
              <CommandRunner
                command="wakeup"
                onComplete={handleCommandComplete}
                onClose={() => setShowWakeup(false)}
                autoRun
                className="flex-1"
              />
            </div>
          ) : showCreateMemo && createMemoArgs ? (
            // Show CommandRunner after form submission
            <div className="p-4 h-full flex flex-col max-w-3xl">
              <CommandRunner
                command="create"
                args={createMemoArgs as unknown as Record<string, unknown>}
                label={buildCreateCommandLabel(createMemoArgs)}
                onComplete={handleCreateComplete}
                onClose={handleCreateClose}
                autoRun
                className="flex-1"
              />
            </div>
          ) : showCreateMemo ? (
            // Show form for input
            <div className="p-4 h-full">
              <NewMemo
                onSubmit={handleMemoSubmit}
                onClose={() => setShowCreateMemo(false)}
              />
            </div>
          ) : selectedCard ? (
            <div className="p-4">
              {/* Question form for pending questions */}
              {selectedQuestion && (
                <div className="mb-4">
                  <QuestionForm
                    question={selectedQuestion}
                    onAnswered={handleQuestionAnswered}
                  />
                </div>
              )}

              {/* Card view */}
              <div className="card">
                <CardView path={selectedCard.relativePath} />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              Select an item to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
