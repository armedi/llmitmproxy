import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState } from "react";
import { requestQuery, sessionsQuery } from "../data/api";
import { Conversation, type FindResult, type FindState } from "../session/Conversation";
import { FindBar, FindRail } from "../session/FindBar";
import { Formatted } from "../components/Markdown";
import { useKeys } from "../lib/hooks";
import { useFocused, useFormatted, useOpenRaw, useSessionRequests } from "../session/hooks";

export const Route = createFileRoute("/session/$id/")({
  // The latest request carries the whole thread so far, so the conversation always shows it.
  loader: async ({ context: { queryClient }, params: { id } }) => {
    const session = (await queryClient.ensureQueryData(sessionsQuery)).find((s) => s.id === id);
    if (session) await queryClient.ensureQueryData(requestQuery(session.latest_request_id));
  },
  component: ConversationView,
});

const NO_FIND: FindState = { query: "", cursor: 0 };

function ConversationView() {
  const { id } = Route.useParams();
  const { session, requests } = useSessionRequests(id);
  // Keep showing the previous turn while the next one loads, instead of flashing "Loading…".
  const { data: detail } = useQuery({ ...requestQuery(session.latest_request_id), placeholderData: keepPreviousData });
  const openRaw = useOpenRaw(session);
  const [focused, setFocused] = useFocused();
  const [formatted, setFormatted] = useFormatted();
  const [find, setFind] = useState<FindState | null>(null);
  const [found, setFound] = useState<FindResult>({ count: 0, marks: [] });
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Keep the view pinned to the bottom as the thread grows, unless the user scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current && !find) el.scrollTop = el.scrollHeight;
  }, [detail]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useKeys({
    f: () => setFocused((f) => !f),
    m: () => setFormatted((m) => !m),
    "mod+f": () => setFind((f) => f ?? { query: "", cursor: 0 }),
    Escape: () => (find ? setFind(null) : false),
  });

  return (
    <>
      {find && <FindBar find={find} result={found} onChange={setFind} onClose={() => setFind(null)} />}
      <div className="session-body-wrap">
        <div className="session-body" ref={scroller} onScroll={onScroll}>
          {!detail ? (
            <div className="placeholder">Loading…</div>
          ) : (
            <Formatted.Provider value={formatted}>
              <Conversation
                detail={detail}
                requests={requests}
                sessionModel={session.model}
                focused={focused}
                find={find ?? NO_FIND}
                onFind={setFound}
                onOpenRequest={openRaw}
              />
            </Formatted.Provider>
          )}
        </div>
        {find && <FindRail result={found} cursor={find.cursor} onJump={(i) => setFind({ ...find, cursor: i })} />}
      </div>
    </>
  );
}
