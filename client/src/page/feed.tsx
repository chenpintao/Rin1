import type { Feed, ProtectedFeed } from "@rin/api";
import { Modal } from "@rin/ui";
import { useContext, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import Popup from "reactjs-popup";
import { Link, useLocation } from "wouter";
import { useAlert, useConfirm } from "../components/dialog";
import { HashTag } from "../components/hashtag";
import { ImageWithFallback } from "../components/image-with-fallback";
import { Waiting } from "../components/loading";
import { Markdown } from "../components/markdown";
import { client } from "../app/runtime";
import { ClientConfigContext } from "../state/config";
import { ProfileContext } from "../state/profile";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { siteName } from "../utils/constants";
import { timeago } from "../utils/timeago";
import { Button } from "../components/button";
import { Tips } from "../components/tips";
import mermaid from "mermaid";
import { AdjacentSection } from "../components/adjacent_feed.tsx";
import { stripImageUrlMetadata } from "../utils/image-upload";

function isProtectedFeedPayload(payload: unknown): payload is ProtectedFeed {
    return typeof payload === "object" && payload !== null && (payload as ProtectedFeed).protected === true;
}

function extractFirstMarkdownImageUrl(content: string) {
  const match = /!\[.*?\]\((\S+?)(?:\s+"[^"]*")?\)/.exec(content);
  if (!match) {
    return undefined;
  }

  return stripImageUrlMetadata(match[1]);
}

export function FeedPage({ id, TOC, clean }: { id: string, TOC: () => JSX.Element, clean: (id: string) => void }) {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();
  const profile = useContext(ProfileContext);
  const [feed, setFeed] = useState<Feed>();
  const [error, setError] = useState<string>();
  const [headImage, setHeadImage] = useState<string>();
  const [protectedFeed, setProtectedFeed] = useState<ProtectedFeed>();
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string>();
  const ref = useRef("");
  const [, setLocation] = useLocation();
  const { showAlert, AlertUI } = useAlert();
  const { showConfirm, ConfirmUI } = useConfirm();
  const [top, setTop] = useState<number>(0);
  const config = useContext(ClientConfigContext);
  const counterEnabled = config.getBoolean('counter.enabled');
  const hasAISummary = Boolean(feed?.ai_summary?.trim());
  const showAISummaryState = feed?.ai_summary_status === "pending" || feed?.ai_summary_status === "processing" || feed?.ai_summary_status === "failed";
  const hashtags = Array.isArray(feed?.hashtags) ? feed.hashtags : (Array.isArray(protectedFeed?.hashtags) ? protectedFeed.hashtags : []);
  // 文章内容区宽度拖拽调整：仅本次会话有效，刷新后恢复默认宽度
  const layoutRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [contentWidthPct, setContentWidthPct] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const dragStateRef = useRef<{ centerX: number; containerWidth: number } | null>(null);
  function deleteFeed() {
    // Confirm
    showConfirm(
      t("article.delete.title"),
      t("article.delete.confirm"),
      () => {
        if (!feed) return;
        client.feed
          .delete(feed.id)
          .then(({ error }) => {
            if (error) {
              showAlert(error.value as string);
            } else {
              showAlert(t("delete.success"));
              setLocation("/");
            }
          });
      })
  }
  function topFeed() {
    const isUnTop = !(top > 0)
    const topNew = isUnTop ? 1 : 0;
    // Confirm
    showConfirm(
      isUnTop ? t("article.top.title") : t("article.untop.title"),
      isUnTop ? t("article.top.confirm") : t("article.untop.confirm"),
      () => {
        if (!feed) return;
        client.feed
          .setTop(feed.id, topNew)
          .then(({ error }) => {
            if (error) {
              showAlert(error.value as string);
            } else {
              showAlert(isUnTop ? t("article.top.success") : t("article.untop.success"));
              setTop(topNew);
            }
          });
      })
  }
  useEffect(() => {
    if (ref.current == id) return;
    setFeed(undefined);
    setError(undefined);
    setHeadImage(undefined);
    setProtectedFeed(undefined);
    setUnlockError(undefined);
    setUnlockPassword("");
    client.feed
      .get(id)
      .then(({ data, error }) => {
        if (error) {
          if (error.status === 403 && isProtectedFeedPayload(error.data)) {
            setProtectedFeed(error.data);
          } else {
            setError(error.value as string);
          }
        } else if (data && typeof data !== "string") {
          setTimeout(() => {
            setFeed(data as any);
            setTop(data.top || 0);
            const headImageUrl = extractFirstMarkdownImageUrl(data.content);
            if (headImageUrl) {
              setHeadImage(headImageUrl);
            }
            clean(id);
          }, 0);
        }
      });
    ref.current = id;
  }, [id]);

  function submitUnlock() {
    if (!protectedFeed || unlocking) return;
    if (!unlockPassword) {
      setUnlockError(t("article.unlock.password_required"));
      return;
    }
    setUnlocking(true);
    setUnlockError(undefined);
    client.feed
      .unlock(id, unlockPassword)
      .then(({ data, error }) => {
        setUnlocking(false);
        if (error) {
          // Server returns 403 with { success: false, error: 'Invalid password' } on mismatch.
          const errorData = error.data as { success?: boolean; error?: string } | undefined;
          setUnlockError(errorData?.error || t("article.unlock.password_error"));
          return;
        }
        if (data?.success) {
          // Cookie is now set; re-fetch the feed to render full content.
          setProtectedFeed(undefined);
          setUnlockPassword("");
          client.feed.get(id).then(({ data, error }) => {
            if (error) {
              if (error.status === 403 && isProtectedFeedPayload(error.data)) {
                setProtectedFeed(error.data);
              } else {
                setError(error.value as string);
              }
            } else if (data && typeof data !== "string") {
              setTimeout(() => {
                setFeed(data as any);
                setTop(data.top || 0);
                const headImageUrl = extractFirstMarkdownImageUrl(data.content);
                if (headImageUrl) {
                  setHeadImage(headImageUrl);
                }
                clean(id);
              }, 0);
            }
          });
        }
      });
  }
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: "default",
    });
    mermaid.run({
      suppressErrors: true,
      nodes: document.querySelectorAll("pre.mermaid_default")
    }).then(() => {
      mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
      });
      mermaid.run({
        suppressErrors: true,
        nodes: document.querySelectorAll("pre.mermaid_dark")
      });
    })
  }, [feed]);

  // 内容区以页面中心为轴对称缩放：宽度 = 2 * 指针到页面中心的距离
  function beginResize(e: ReactPointerEvent<HTMLDivElement>) {
    const layout = layoutRef.current;
    if (!layout) return;
    e.preventDefault();
    const rect = layout.getBoundingClientRect();
    dragStateRef.current = { centerX: rect.left + rect.width / 2, containerWidth: rect.width };
    setContentWidthPct((prev) => {
      if (prev != null) return prev;
      const mainRect = mainRef.current?.getBoundingClientRect();
      if (!mainRect || rect.width === 0) return prev;
      return Math.min(96, Math.max(30, Math.round((mainRect.width / rect.width) * 100)));
    });
    setResizing(true);
  }
  function resetContentWidth() {
    setContentWidthPct(null);
  }
  useEffect(() => {
    if (!resizing) return;
    const handleMove = (e: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag || drag.containerWidth === 0) return;
      const pct = (2 * Math.abs(e.clientX - drag.centerX) / drag.containerWidth) * 100;
      setContentWidthPct(Math.min(96, Math.max(30, Math.round(pct))));
    };
    const stop = () => setResizing(false);
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [resizing]);
  // 拖拽期间锁定全局光标与文本选择
  useEffect(() => {
    if (!resizing) return;
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
    };
  }, [resizing]);
  // 右侧空间放不下目录（w-80 = 320px）时自动隐藏，空间结构保留，内容区保持居中
  const tocWrapRef = useRef<HTMLDivElement>(null);
  const [tocAvailable, setTocAvailable] = useState(true);
  useEffect(() => {
    const el = tocWrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setTocAvailable((entry?.contentRect.width ?? 0) >= 320);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const resizeHandles = (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("article.resize.aria")}
        title={t("article.resize.reset")}
        onPointerDown={beginResize}
        onDoubleClick={resetContentWidth}
        className="group absolute inset-y-0 -left-1 z-30 w-3 cursor-col-resize touch-none"
      >
        <div className={`sticky top-1/2 mx-auto h-24 w-[3px] -translate-y-1/2 rounded-full transition-all duration-200 ${resizing ? "w-[5px] bg-theme" : "bg-neutral-300/80 group-hover:w-[5px] group-hover:bg-theme dark:bg-neutral-600/80 dark:group-hover:bg-theme"}`} />
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("article.resize.aria")}
        title={t("article.resize.reset")}
        onPointerDown={beginResize}
        onDoubleClick={resetContentWidth}
        className="group absolute inset-y-0 -right-1 z-30 w-3 cursor-col-resize touch-none"
      >
        <div className={`sticky top-1/2 mx-auto h-24 w-[3px] -translate-y-1/2 rounded-full transition-all duration-200 ${resizing ? "w-[5px] bg-theme" : "bg-neutral-300/80 group-hover:w-[5px] group-hover:bg-theme dark:bg-neutral-600/80 dark:group-hover:bg-theme"}`} />
      </div>
    </>
  );

  return (
    <Waiting for={feed || error || protectedFeed}>
      {(feed || protectedFeed) && (
        <Helmet>
          <title>{`${(feed ?? protectedFeed)?.title ?? "Unnamed"} - ${siteConfig.name}`}</title>
          <meta property="og:site_name" content={siteName} />
          <meta property="og:title" content={(feed ?? protectedFeed)?.title ?? ""} />
          <meta property="og:image" content={headImage ?? siteConfig.avatar} />
          <meta property="og:type" content="article" />
          <meta property="og:url" content={document.URL} />
          <meta
            name="og:description"
            content={
              feed
                ? feed.content.length > 200
                  ? feed.content.substring(0, 200)
                  : feed.content
                : (protectedFeed?.summary ?? "").slice(0, 200)
            }
          />
          {feed && <meta name="author" content={feed.user.username} />}
          <meta
            name="keywords"
            content={hashtags.map(({ name }) => name).join(", ")}
          />
          <meta
            name="description"
            content={
              feed
                ? feed.content.length > 200
                  ? feed.content.substring(0, 200)
                  : feed.content
                : (protectedFeed?.summary ?? "").slice(0, 200)
            }
          />
        </Helmet>
      )}
      <div ref={layoutRef} className="w-full flex flex-row justify-center ani-show">
        {error && (
          <>
            <div className="flex flex-col wauto rounded-2xl bg-w m-2 p-6 items-center justify-center space-y-2">
              <h1 className="text-xl font-bold t-primary">{error}</h1>
              {error === "Not found" && id === "about" && (
                <Tips value={t("about.notfound")} />
              )}
              <Button
                title={t("index.back")}
                onClick={() => (window.location.href = "/")}
              />
            </div>
          </>
        )}
        {protectedFeed && !feed && !error && (
          <main className="wauto">
            <article
              className="rounded-2xl bg-w m-2 px-6 py-8 flex flex-col items-center text-center"
              aria-label={protectedFeed.title ?? "Unnamed"}
            >
              <i className="ri-lock-2-line text-5xl t-secondary mb-4" aria-hidden="true" />
              <h1 className="text-2xl font-bold t-primary break-all">
                {protectedFeed.title ?? t("article.unlock.untitled")}
              </h1>
              {protectedFeed.summary && (
                <p className="mt-3 max-w-prose whitespace-pre-line break-words t-secondary [overflow-wrap:anywhere]">
                  {protectedFeed.summary}
                </p>
              )}
              <div className="mt-2 flex gap-1 justify-center text-[12px] text-gray-400">
                <span title={new Date(protectedFeed.createdAt).toLocaleString()}>
                  {t("feed_card.published$time", { time: timeago(protectedFeed.createdAt) })}
                </span>
                {protectedFeed.createdAt !== protectedFeed.updatedAt && (
                  <span title={new Date(protectedFeed.updatedAt).toLocaleString()}>
                    {t("feed_card.updated$time", { time: timeago(protectedFeed.updatedAt) })}
                  </span>
                )}
              </div>
              {counterEnabled && (protectedFeed.pv > 0 || protectedFeed.uv > 0) && (
                <p className="mt-1 text-[12px] text-gray-400 font-normal link-line">
                  <span> {t("count.pv")} </span>
                  <span>{protectedFeed.pv}</span>
                  <span> |</span>
                  <span> {t("count.uv")} </span>
                  <span>{protectedFeed.uv}</span>
                </p>
              )}
              {hashtags.length > 0 && (
                <div className="mt-4 flex flex-row flex-wrap justify-center gap-x-2">
                  {hashtags.map(({ name }, index) => (
                    <HashTag key={index} name={name} />
                  ))}
                </div>
              )}
              <div className="mt-6 w-full max-w-sm flex flex-col items-center gap-3">
                <div className="w-full flex flex-row items-center gap-2 rounded-xl border border-black/10 dark:border-white/10 bg-secondary px-3 py-2">
                  <i className="ri-key-2-line t-secondary" aria-hidden="true" />
                  <input
                    type="password"
                    autoFocus
                    autoComplete="current-password"
                    aria-label={t("article.unlock.password_placeholder")}
                    placeholder={t("article.unlock.password_placeholder")}
                    value={unlockPassword}
                    onChange={(e) => {
                      setUnlockPassword(e.target.value);
                      if (unlockError) setUnlockError(undefined);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitUnlock();
                    }}
                    className="w-full bg-transparent outline-none t-primary placeholder:text-neutral-400"
                  />
                </div>
                {unlockError && (
                  <p className="text-sm text-red-500">{unlockError}</p>
                )}
                <button
                  onClick={submitUnlock}
                  disabled={unlocking}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-theme px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-theme-hover active:bg-theme-active disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {unlocking ? t("article.unlock.submitting") : t("article.unlock.submit")}
                </button>
              </div>
            </article>
          </main>
        )}
        {feed && !error && (
          <>
            <div className={contentWidthPct == null ? "xl:w-64" : "hidden lg:block min-w-0 flex-1"} />
            <main
              ref={mainRef}
              className={`relative ${contentWidthPct == null ? "wauto" : "shrink-0"} transition-[width] ease-out ${resizing ? "duration-100" : "duration-300"}`}
              style={contentWidthPct != null ? { width: `${contentWidthPct}%` } : undefined}
            >
              <article
                className="rounded-2xl bg-w m-2 px-6 py-4"
                aria-label={feed.title ?? "Unnamed"}
              >
                <div className="flex justify-between">
                  <div>
                    <div className="mt-1 mb-1 flex gap-1">
                      <p
                        className="text-gray-400 text-[12px]"
                        title={new Date(feed.createdAt).toLocaleString()}
                      >
                        {t("feed_card.published$time", {
                          time: timeago(feed.createdAt),
                        })}
                      </p>

                      {feed.createdAt !== feed.updatedAt && (
                        <p
                          className="text-gray-400 text-[12px]"
                          title={new Date(feed.updatedAt).toLocaleString()}
                        >
                          {t("feed_card.updated$time", {
                            time: timeago(feed.updatedAt),
                          })}
                        </p>
                      )}
                    </div>
                    {counterEnabled && <p className='text-[12px] text-gray-400 font-normal link-line'>
                      <span> {t("count.pv")} </span>
                      <span>
                        {feed.pv}
                      </span>
                      <span> |</span>
                      <span> {t("count.uv")} </span>
                      <span>
                        {feed.uv}
                      </span>
                    </p>}
                    <div className="flex flex-row items-center">
                      <h1 className="text-2xl font-bold t-primary break-all">
                        {feed.title}
                      </h1>
                      <div className="flex-1 w-0" />
                    </div>
                  </div>
                  <div className="pt-2">
                    {profile?.permission && (
                      <div className="flex gap-2">
                        <button
                          aria-label={top > 0 ? t("untop.title") : t("top.title")}
                          onClick={topFeed}
                          className={`flex-1 flex flex-col items-end justify-center px-2 py rounded-full transition ${top > 0 ? "bg-theme text-white hover:bg-theme-hover active:bg-theme-active" : "bg-secondary bg-button dark:text-neutral-400"}`}
                        >
                          <i className="ri-skip-up-line" />
                        </button>
                        <Link
                          aria-label={t("edit")}
                          href={`/admin/writing/${feed.id}`}
                          className="flex-1 flex flex-col items-end justify-center px-2 py bg-secondary bg-button rounded-full transition"
                        >
                          <i className="ri-edit-2-line dark:text-neutral-400" />
                        </Link>
                        <button
                          aria-label={t("delete.title")}
                          onClick={deleteFeed}
                          className="flex-1 flex flex-col items-end justify-center px-2 py bg-secondary bg-button rounded-full transition"
                        >
                          <i className="ri-delete-bin-7-line text-red-500" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {(hasAISummary || showAISummaryState) && (
                  <div className="my-4 p-4 rounded-xl bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 border border-purple-100 dark:border-purple-800/30">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <i className="ri-sparkling-2-fill text-purple-500" />
                        <span className="text-sm font-medium text-purple-600 dark:text-purple-400">
                          {t('ai_summary.title')}
                        </span>
                      </div>
                      {showAISummaryState ? (
                        <span className="rounded-full bg-white/70 px-2 py-1 text-xs font-medium text-purple-700 dark:bg-white/10 dark:text-purple-300">
                          {t(`ai_summary.status.${feed.ai_summary_status}`)}
                        </span>
                      ) : null}
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed t-secondary [overflow-wrap:anywhere]">
                      {hasAISummary ? feed.ai_summary : t(`ai_summary.message.${feed.ai_summary_status}`)}
                    </p>
                    {feed.ai_summary_status === "failed" && feed.ai_summary_error ? (
                      <p className="mt-2 whitespace-pre-wrap text-xs text-rose-600 dark:text-rose-300 [overflow-wrap:anywhere]">
                        {feed.ai_summary_error}
                      </p>
                    ) : null}
                  </div>
                )}
                <Markdown content={feed.content} />
                <div className="mt-6 flex flex-col gap-2">
                  {hashtags.length > 0 && (
                    <div className="flex flex-row flex-wrap gap-x-2">
                      {hashtags.map(({ name }, index) => (
                        <HashTag key={index} name={name} />
                      ))}
                    </div>
                  )}
                  <div className="flex min-w-0 flex-row items-center">
                    <ImageWithFallback
                      src={feed.user.avatar || "/avatar.png"}
                      alt={feed.user.username}
                      className="h-8 w-8 rounded-full"
                    />
                    <div className="ml-2 min-w-0">
                      <span className="block truncate text-sm text-gray-400 cursor-default">
                        {feed.user.username}
                      </span>
                    </div>
                  </div>
                </div>
              </article>
              <AdjacentSection id={id} setError={setError} />
              {feed && <Comments id={`${feed.id}`} />}
              <div className="h-16" />
              {resizeHandles}
            </main>
            <div ref={tocWrapRef} className={contentWidthPct == null ? "w-80 hidden lg:block relative" : "relative hidden lg:block min-w-0 flex-1"}>
              <div className={`start-0 end-0 top-[5.5rem] sticky w-80 ${contentWidthPct != null && !tocAvailable ? "hidden" : ""}`}>
                <TOC />
              </div>
            </div>
          </>
        )}
      </div>
      {resizing && contentWidthPct != null && (
        <div className="pointer-events-none fixed left-1/2 top-16 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-black/5 bg-[rgb(var(--rin-surface-rgb)/0.95)] px-4 py-1.5 text-sm font-medium shadow-[0_8px_30px_rgba(15,23,42,0.12)] t-primary dark:border-white/10">
          <i className="ri-contract-left-right-line text-theme" aria-hidden="true" />
          <span className="tabular-nums">{contentWidthPct}%</span>
        </div>
      )}
      <AlertUI />
      <ConfirmUI />
    </Waiting>
  );
}

export function TOCHeader({ TOC }: { TOC: () => JSX.Element }) {
  const [isOpened, setIsOpened] = useState(false);

  return (
    <div className="shrink-0 lg:hidden">
      <button
        onClick={() => setIsOpened(true)}
        className="w-10 h-10 rounded-full flex flex-row items-center justify-center"
      >
        <i className="ri-menu-2-line text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 ri-lg md:ri-sm md:t-secondary"></i>
      </button>
      <Modal
        isOpen={isOpened}
        onRequestClose={() => setIsOpened(false)}
        contentLabel="Table of contents"
        size="lg"
        panelClassName="p-4"
      >
        <div className="relative max-h-[75vh] overflow-auto t-primary">
          <TOC />
        </div>
      </Modal>
    </div>
  );
}

function CommentInput({
  id,
  onRefresh,
}: {
  id: string;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestWebsite, setGuestWebsite] = useState("");
  const [error, setError] = useState("");
  const { showAlert, AlertUI } = useAlert();
  const profile = useContext(ProfileContext);
  const [, setLocation] = useLocation();
  const config = useContext(ClientConfigContext);
  // guest comments enabled by default; admin can disable via client config `comment.guest.enabled=false`
  const rawGuest = config.get('comment.guest.enabled');
  const guestEnabled = rawGuest !== false && rawGuest !== 'false';
  function errorHumanize(error: string) {
    if (error === "Unauthorized") return t("login.required");
    else if (error === "Content is required") return t("comment.empty");
    else if (error === "Guest name is required") return t("comment.guest_name_required");
    return error;
  }
  function submit() {
    if (profile) {
      client.comment
        .create(parseInt(id), { content })
        .then(({ error }) => {
          if (error) {
            setError(errorHumanize(error.value as string));
          } else {
            setContent("");
            setError("");
            showAlert(t("comment.success"), () => {
              onRefresh();
            });
          }
        });
    } else if (guestEnabled) {
      if (!guestName.trim()) {
        setError(t("comment.guest_name_required"));
        return;
      }
      client.comment
        .create(parseInt(id), {
          content,
          guestName: guestName.trim(),
          guestEmail: guestEmail.trim() || undefined,
          guestWebsite: guestWebsite.trim() || undefined,
        })
        .then(({ error }) => {
          if (error) {
            setError(errorHumanize(error.value as string));
          } else {
            setContent("");
            setGuestName("");
            setGuestEmail("");
            setGuestWebsite("");
            setError("");
            showAlert(t("comment.success"), () => {
              onRefresh();
            });
          }
        });
    } else {
      setLocation('/login');
    }
  }
  return (
    <div className="w-full rounded-2xl bg-w t-primary p-6 items-end flex flex-col">
      <div className="flex flex-col w-full items-start mb-4">
        <label htmlFor="comment">{t("comment.title")}</label>
      </div>
      {profile ? (<>
        <textarea
          id="comment"
          placeholder={t("comment.placeholder.title")}
          className="bg-w w-full h-24 rounded-lg"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <button
          className="mt-4 bg-theme text-white px-4 py-2 rounded-full"
          onClick={submit}
        >
          {t("comment.submit")}
        </button>
      </>) : guestEnabled ? (<>
        <input
          type="text"
          placeholder={t("comment.guest_name_placeholder")}
          className="bg-w w-full rounded-lg px-3 py-2 mb-2 border border-gray-200 dark:border-gray-700"
          value={guestName}
          onChange={(e) => setGuestName(e.target.value)}
        />
        <input
          type="email"
          placeholder={t("comment.guest_email_placeholder")}
          className="bg-w w-full rounded-lg px-3 py-2 mb-2 border border-gray-200 dark:border-gray-700"
          value={guestEmail}
          onChange={(e) => setGuestEmail(e.target.value)}
        />
        <input
          type="url"
          placeholder={t("comment.guest_website_placeholder")}
          className="bg-w w-full rounded-lg px-3 py-2 mb-2 border border-gray-200 dark:border-gray-700"
          value={guestWebsite}
          onChange={(e) => setGuestWebsite(e.target.value)}
        />
        <textarea
          id="comment"
          placeholder={t("comment.placeholder.title")}
          className="bg-w w-full h-24 rounded-lg"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <button
          className="mt-4 bg-theme text-white px-4 py-2 rounded-full"
          onClick={submit}
        >
          {t("comment.submit")}
        </button>
      </>) : (
        <div className="flex flex-row w-full items-center justify-center space-x-2 py-12">
          <button
            className="mt-2 bg-theme text-white px-4 py-2 rounded-full"
            onClick={() => setLocation('/login')}
          >
            {t("login.required")}
          </button>
        </div>
      )}
      {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
      <AlertUI />
    </div>
  );
}

type Comment = {
  id: number;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  user?: {
    id: number;
    username: string;
    avatar: string | null;
    permission: number | null;
  } | null;
  guestName?: string;
  guestEmail?: string;
  guestWebsite?: string;
};

function Comments({ id }: { id: string }) {
  const config = useContext(ClientConfigContext);
  const [comments, setComments] = useState<Comment[]>([]);
  const [error, setError] = useState<string>();
  const ref = useRef("");
  const { t } = useTranslation();

  function loadComments() {
    client.comment
      .list(parseInt(id))
      .then(({ data, error }) => {
        if (error) {
          setError(error.value as string);
        } else if (data && Array.isArray(data)) {
          setComments(data as any);
        }
      });
  }
  useEffect(() => {
    if (ref.current == id) return;
    loadComments();
    ref.current = id;
  }, [id]);
  return (
    <>
      {config.getBoolean('comment.enabled') &&
        <div className="m-2 flex flex-col justify-center items-center">
          <CommentInput id={id} onRefresh={loadComments} />
          {error && (
            <>
              <div className="flex flex-col wauto rounded-2xl bg-w t-primary m-2 p-6 items-center justify-center">
                <h1 className="text-xl font-bold t-primary">{error}</h1>
                <button
                  className="mt-2 bg-theme text-white px-4 py-2 rounded-full"
                  onClick={loadComments}
                >
                  {t("reload")}
                </button>
              </div>
            </>
          )}
          {comments.length > 0 && (
            <div className="w-full">
              {comments.map((comment) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  onRefresh={loadComments}
                />
              ))}
            </div>
          )}
        </div>
      }
    </>
  );
}

function CommentItem({
  comment,
  onRefresh,
}: {
  comment: Comment;
  onRefresh: () => void;
}) {
  const { showConfirm, ConfirmUI } = useConfirm();
  const { showAlert, AlertUI } = useAlert();
  const { t } = useTranslation();
  const profile = useContext(ProfileContext);
  const commenterName = comment.user?.username || comment.guestName || t("anonymous");
  const commenterAvatar = comment.user?.avatar || "/avatar.png";
  function deleteComment() {
    showConfirm(
      t("delete.comment.title"),
      t("delete.comment.confirm"),
      async () => {
        client.comment
          .delete(comment.id)
          .then(({ error }) => {
            if (error) {
              showAlert(error.value as string);
            } else {
              showAlert(t("delete.success"), () => {
                onRefresh();
              });
            }
          });
      })
  }
  return (
    <div className="flex flex-row items-start rounded-xl mt-2">
      <ImageWithFallback
        src={commenterAvatar}
        alt={commenterName}
        className="mt-4 h-8 w-8 rounded-full"
      />
      <div className="flex flex-col flex-1 w-0 ml-2 bg-w rounded-xl p-4">
        <div className="flex min-w-0 flex-row items-center gap-2">
          <span className="min-w-0 truncate text-base font-bold t-primary">
            {commenterName}
          </span>
          {comment.guestWebsite && (
            <a
              href={comment.guestWebsite}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-gray-400 transition-colors hover:text-theme"
            >
              <i className="ri-external-link-line"></i>
            </a>
          )}
          <div className="flex-1 w-0" />
          <span
            title={new Date(comment.createdAt).toLocaleString()}
            className="shrink-0 text-sm text-gray-400"
          >
            {timeago(comment.createdAt)}
          </span>
        </div>
        <p className="break-words t-primary [overflow-wrap:anywhere]">{comment.content}</p>
        <div className="flex flex-row justify-end">
          {(profile?.permission || (comment.user && profile?.id == comment.user.id)) && (
            <Popup
              arrow={false}
              trigger={
                <button className="px-2 py bg-secondary rounded-full">
                  <i className="ri-more-fill t-secondary"></i>
                </button>
              }
              position="left center"
            >
              <div className="flex flex-row self-end mr-2">
                <button
                  onClick={deleteComment}
                  aria-label={t("delete.comment.title")}
                  className="px-2 py bg-secondary rounded-full"
                >
                  <i className="ri-delete-bin-2-line t-secondary"></i>
                </button>
              </div>
            </Popup>
          )}
        </div>
      </div>
      <ConfirmUI />
      <AlertUI />
    </div>
  );
}
