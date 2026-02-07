/**
 * React hooks for experience authors.
 *
 * These hooks simplify common patterns in experience Canvas components:
 * - useToolCall: wraps callTool with loading/error state
 * - useSharedState: typed accessor for a specific state key
 * - useOptimisticTool: optimistic updates with rollback on error
 * - useParticipants: parsed participant list with structured data
 *
 * Hooks rely on React being available as a global (provided by the bundler runtime).
 */

// React access: lazy getter that works in both contexts
// 1. When imported by Next.js (room page): globalThis.React may not be set yet,
//    but the bundler will have React available via the normal module system
// 2. When running inside a bundled experience: globalThis.React is set by the runtime
function getReact(): typeof import('react') {
  const R = (globalThis as any).React;
  if (!R) throw new Error('React is not available. Hooks must be used inside a Canvas component.');
  return R;
}

// Proxy that lazily accesses React on each call rather than at import time
const React = new Proxy({} as typeof import('react'), {
  get(_target, prop) {
    return (getReact() as any)[prop];
  },
});

type CallToolFn = (name: string, input: any) => Promise<any>;

// ─── useToolCall ─────────────────────────────────────────────────────────────

export type UseToolCallReturn = {
  call: (name: string, input: any) => Promise<any>;
  loading: boolean;
  error: string | null;
};

/**
 * Wraps callTool with loading and error tracking.
 *
 * Usage:
 *   const { call, loading, error } = useToolCall(callTool);
 *   <button onClick={() => call('counter.increment', {})} disabled={loading}>
 */
export function useToolCall(callTool: CallToolFn): UseToolCallReturn {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const call = React.useCallback(
    async (name: string, input: any) => {
      setLoading(true);
      setError(null);
      try {
        const result = await callTool(name, input);
        return result;
      } catch (err: any) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [callTool]
  );

  return { call, loading, error };
}

// ─── useSharedState ──────────────────────────────────────────────────────────

/**
 * Typed accessor for a specific key in shared state.
 *
 * Usage:
 *   const count = useSharedState<number>(sharedState, 'count', 0);
 */
export function useSharedState<T>(
  sharedState: Record<string, any>,
  key: string,
  defaultValue?: T
): T {
  const value = sharedState[key];
  if (value === undefined) return defaultValue as T;
  return value as T;
}

// ─── useOptimisticTool ───────────────────────────────────────────────────────

export type UseOptimisticToolReturn = {
  call: (name: string, input: any, optimisticState: Record<string, any>) => Promise<any>;
  state: Record<string, any>;
  pending: boolean;
};

/**
 * Applies an optimistic state update immediately, then reverts on error.
 *
 * Usage:
 *   const { call, state, pending } = useOptimisticTool(callTool, sharedState);
 *   call('counter.increment', {}, { count: sharedState.count + 1 });
 */
export function useOptimisticTool(
  callTool: CallToolFn,
  sharedState: Record<string, any>
): UseOptimisticToolReturn {
  const [optimistic, setOptimistic] = React.useState<Record<string, any> | null>(null);
  const [pending, setPending] = React.useState(false);

  const call = React.useCallback(
    async (name: string, input: any, optimisticState: Record<string, any>) => {
      setOptimistic(optimisticState);
      setPending(true);
      try {
        const result = await callTool(name, input);
        // On success, optimistic state is replaced by server state via sharedState prop
        setOptimistic(null);
        return result;
      } catch (err) {
        // On error, revert optimistic state
        setOptimistic(null);
        throw err;
      } finally {
        setPending(false);
      }
    },
    [callTool]
  );

  // Merge: optimistic overrides shared state while pending
  const state = optimistic ? { ...sharedState, ...optimistic } : sharedState;

  return { call, state, pending };
}

// ─── useAnimationFrame ───────────────────────────────────────────────────────

/**
 * Decouples render frequency from state sync frequency.
 * State updates are buffered and applied at most once per animation frame.
 * Optional interpolation function smooths transitions between states.
 *
 * Usage:
 *   const displayState = useAnimationFrame(sharedState);
 *   // OR with interpolation:
 *   const displayState = useAnimationFrame(sharedState, (prev, next, t) => ({
 *     ...next,
 *     x: prev.x + (next.x - prev.x) * t,
 *   }));
 */
export function useAnimationFrame(
  sharedState: Record<string, any>,
  interpolate?: (prev: Record<string, any>, next: Record<string, any>, t: number) => Record<string, any>
): Record<string, any> {
  const prevStateRef = React.useRef(sharedState);
  const targetStateRef = React.useRef(sharedState);
  const displayStateRef = React.useRef(sharedState);
  const [displayState, setDisplayState] = React.useState(sharedState);
  const rafRef = React.useRef<number | null>(null);
  const transitionStartRef = React.useRef(0);
  const TRANSITION_MS = 50; // Interpolation window

  // When shared state changes, set as target
  React.useEffect(() => {
    prevStateRef.current = displayStateRef.current;
    targetStateRef.current = sharedState;
    transitionStartRef.current = performance.now();

    if (!rafRef.current) {
      const tick = () => {
        const now = performance.now();
        const elapsed = now - transitionStartRef.current;
        const t = Math.min(elapsed / TRANSITION_MS, 1);

        let next: Record<string, any>;
        if (interpolate && t < 1) {
          next = interpolate(prevStateRef.current, targetStateRef.current, t);
        } else {
          next = targetStateRef.current;
        }

        displayStateRef.current = next;
        setDisplayState(next);

        if (t < 1 && interpolate) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          rafRef.current = null;
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [sharedState, interpolate]);

  // Cleanup
  React.useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  return displayState;
}

// ─── useParticipants ─────────────────────────────────────────────────────────

export type ParsedParticipant = {
  id: string;
  username: string;
  type: 'human' | 'ai' | 'unknown';
  index: number;
};

/**
 * Parses the participant ID list into structured objects.
 *
 * Participant IDs follow the format: {username}-{type}-{N}
 * e.g., "alice-human-1", "claude-ai-2"
 */
export function useParticipants(participants: string[]): ParsedParticipant[] {
  return React.useMemo(() => {
    return participants.map((id) => {
      const match = id.match(/^(.+)-(human|ai)-(\d+)$/);
      if (match) {
        return {
          id,
          username: match[1],
          type: match[2] as 'human' | 'ai',
          index: parseInt(match[3], 10),
        };
      }
      return { id, username: id, type: 'unknown' as const, index: 0 };
    });
  }, [participants]);
}

// ─── useFollow ──────────────────────────────────────────────────────────────

type FollowMode = 'viewport' | 'actions' | 'both';

type FollowData = {
  targetActorId: string;
  mode: FollowMode;
  since: number;
};

type EphemeralAction = {
  name: string;
  input: any;
  actorId: string;
  ts: number;
};

type DispatchEphemeralActionFn = (name: string, input: any) => void;
type OnEphemeralActionFn = (handler: (action: EphemeralAction) => void) => () => void;
type SetEphemeralFn = (data: Record<string, any>) => void;

export type UseFollowReturn = {
  /** Start following a target participant. */
  follow: (targetActorId: string, mode: FollowMode) => void;
  /** Stop following. */
  unfollow: () => void;
  /** Who you are currently following, or null. */
  following: FollowData | null;
  /** List of actor IDs that are following you. */
  followers: Array<{ actorId: string; mode: FollowMode; since: number }>;
};

/**
 * Manages follow-mode state via ephemeral presence.
 *
 * Stores follow intent in ephemeral state under `_follow` key and dispatches
 * `follow.started` / `follow.stopped` ephemeral actions to notify participants.
 *
 * Usage:
 *   const { follow, unfollow, following, followers } = useFollow(
 *     actorId, participants, ephemeralState, setEphemeral,
 *     onEphemeralAction, dispatchEphemeralAction
 *   );
 *   follow('alice-human-1', 'viewport');
 */
export function useFollow(
  actorId: string,
  participants: string[],
  ephemeralState: Record<string, Record<string, any>>,
  setEphemeral: SetEphemeralFn,
  _onEphemeralAction?: OnEphemeralActionFn,
  dispatchEphemeralAction?: DispatchEphemeralActionFn,
): UseFollowReturn {
  // Derive current follow state from own ephemeral data
  const myEphemeral = ephemeralState[actorId];
  const following: FollowData | null = myEphemeral?._follow ?? null;

  // Derive who is following you from all participants' ephemeral data
  const followers = React.useMemo(() => {
    const result: Array<{ actorId: string; mode: FollowMode; since: number }> = [];
    for (const pid of participants) {
      if (pid === actorId) continue;
      const peerFollow = ephemeralState[pid]?._follow as FollowData | undefined;
      if (peerFollow && peerFollow.targetActorId === actorId) {
        result.push({
          actorId: pid,
          mode: peerFollow.mode,
          since: peerFollow.since,
        });
      }
    }
    return result;
  }, [participants, ephemeralState, actorId]);

  const follow = React.useCallback(
    (targetActorId: string, mode: FollowMode) => {
      // Don't follow yourself
      if (targetActorId === actorId) return;

      const followData: FollowData = {
        targetActorId,
        mode,
        since: Date.now(),
      };

      // Store in ephemeral presence so all participants can see
      setEphemeral({ _follow: followData });

      // Dispatch action to notify participants
      if (dispatchEphemeralAction) {
        dispatchEphemeralAction('follow.started', {
          follower: actorId,
          target: targetActorId,
          mode,
        });
      }
    },
    [actorId, setEphemeral, dispatchEphemeralAction],
  );

  const unfollow = React.useCallback(() => {
    const currentTarget = following?.targetActorId;

    // Clear follow from ephemeral presence
    setEphemeral({ _follow: null });

    // Dispatch action to notify participants
    if (dispatchEphemeralAction && currentTarget) {
      dispatchEphemeralAction('follow.stopped', {
        follower: actorId,
        target: currentTarget,
      });
    }
  }, [actorId, following, setEphemeral, dispatchEphemeralAction]);

  // Auto-unfollow when the target leaves the room
  React.useEffect(() => {
    if (!following) return;
    if (!participants.includes(following.targetActorId)) {
      // Target is no longer in the room, unfollow silently
      setEphemeral({ _follow: null });
    }
  }, [following, participants, setEphemeral]);

  return { follow, unfollow, following, followers };
}

// ─── useTypingIndicator ──────────────────────────────────────────────────────

/**
 * Manages typing/activity indicators via ephemeral state.
 *
 * Usage:
 *   const { setTyping, typingUsers } = useTypingIndicator(actorId, ephemeralState, setEphemeral);
 *
 *   // Call setTyping(true) when the user starts typing
 *   // Call setTyping(false) when they stop (auto-clears after 3s)
 *   // typingUsers is an array of actor IDs currently typing
 */
export function useTypingIndicator(
  actorId: string,
  ephemeralState: Record<string, Record<string, any>>,
  setEphemeral: (data: Record<string, any>) => void,
  timeoutMs: number = 3000,
) {
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const setTyping = React.useCallback((isTyping: boolean) => {
    setEphemeral({ _typing: isTyping ? Date.now() : null });

    // Auto-clear after timeout
    if (timerRef.current) clearTimeout(timerRef.current);
    if (isTyping) {
      timerRef.current = setTimeout(() => {
        setEphemeral({ _typing: null });
      }, timeoutMs);
    }
  }, [setEphemeral, timeoutMs]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Compute list of typing users (exclude self, filter stale >5s)
  const now = Date.now();
  const typingUsers = Object.entries(ephemeralState)
    .filter(([id, data]) => id !== actorId && data._typing && (now - data._typing) < timeoutMs + 2000)
    .map(([id]) => id);

  return { setTyping, typingUsers };
}
