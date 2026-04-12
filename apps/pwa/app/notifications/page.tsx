"use client";

import { useEffect, useState } from "react";
import { AppShell, EmptyState, ErrorState, LoadingState, SessionGuard } from "../components";
import { ApiError, getSession, listNotifications } from "../../lib/api-client";

type Notification = {
  id: string;
  title: string;
  body: string;
  status: string;
  createdAt: string;
};

export default function NotificationsPage() {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const session = getSession();
      if (!session) return;

      setLoading(true);
      setError(null);
      try {
        const data = await listNotifications(session.userId);
        setItems(data.notifications);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("Could not load notifications");
        }
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  return (
    <SessionGuard>
      <AppShell title="Notifications">
        {loading && <LoadingState label="Loading notifications..." />}
        {!loading && error && <ErrorState label={error} />}
        {!loading && !error && items.length === 0 && <EmptyState label="No notifications yet" />}

        {!loading && !error && items.length > 0 && (
          <ul className="list">
            {items.map((item) => (
              <li key={item.id}>
                <strong>{item.title || "Notification"}</strong>
                <p style={{ margin: "6px 0" }}>{item.body}</p>
                <p className="muted">{item.status} • {new Date(item.createdAt).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        )}
      </AppShell>
    </SessionGuard>
  );
}

