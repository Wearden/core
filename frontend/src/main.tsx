import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { I18nProvider } from "./i18n";
import { applyStoredTheme } from "./layout/Shell";
import { ErrorBoundary, FeedbackProvider } from "./components/feedback";
import "./index.css";

applyStoredTheme();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <FeedbackProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </FeedbackProvider>
      </I18nProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
