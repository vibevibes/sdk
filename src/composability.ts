/**
 * Inter-Experience Composability
 *
 * Level 1: importTools — Import tools from another experience's npm package
 * Level 2: EmbeddedExperience — Embed another experience's Canvas with scoped state
 */

import type { ToolDef, CanvasProps } from './types';

/**
 * Import tools from another experience module.
 *
 * Usage:
 *   import chatExp from "@vibevibes/chat";
 *   const chatTools = importTools(chatExp, ["chat.send", "chat.clear"]);
 *   export default defineExperience({ tools: [...myTools, ...chatTools], ... });
 *
 * Or import all tools:
 *   const allChatTools = importTools(chatExp, "*");
 *
 * Optional prefix to namespace imported tools:
 *   const chatTools = importTools(chatExp, "*", "chat");
 *   // "send" becomes "chat.send"
 */
export function importTools(
  experienceModule: { tools: ToolDef[] },
  toolNames: string[] | '*',
  prefix?: string,
): ToolDef[] {
  if (!experienceModule?.tools) {
    throw new Error('importTools: experience module has no tools array');
  }

  let tools: ToolDef[];
  if (toolNames === '*') {
    tools = [...experienceModule.tools];
  } else {
    tools = experienceModule.tools.filter(t => toolNames.includes(t.name));
    const found = tools.map(t => t.name);
    const missing = toolNames.filter(n => !found.includes(n));
    if (missing.length > 0) {
      throw new Error(`importTools: tools not found: ${missing.join(', ')}`);
    }
  }

  if (prefix) {
    return tools.map(t => ({
      ...t,
      name: `${prefix}.${t.name}`,
    }));
  }

  return tools;
}

function getReact(): any {
  const R = (globalThis as any).React;
  if (!R) throw new Error('React is not available.');
  return R;
}

function h(type: string | Function, props: any, ...children: any[]) {
  return getReact().createElement(type, props, ...children);
}

/**
 * Props for the EmbeddedExperience component.
 */
export type EmbeddedExperienceProps = {
  /** The child experience module to embed. */
  experience: { Canvas: React.FC<CanvasProps>; tools: ToolDef[] };
  /** Key in parent state where child experience state lives. */
  stateKey: string;
  /** Parent's shared state. */
  sharedState: Record<string, any>;
  /** Parent's callTool function. */
  callTool: (name: string, input: any) => Promise<any>;
  /** Parent's room ID. */
  roomId: string;
  /** Parent's actor ID. */
  actorId: string;
  /** Parent's participants. */
  participants: string[];
  /** Parent's ephemeral state. */
  ephemeralState: Record<string, Record<string, any>>;
  /** Parent's setEphemeral. */
  setEphemeral: (data: Record<string, any>) => void;
  /** Parent's room config. */
  roomConfig?: Record<string, any>;
  /** Container style. */
  style?: Record<string, any>;
  /** Container className. */
  className?: string;
};

/**
 * Embeds another experience's Canvas as a sub-component with scoped state.
 *
 * The child experience reads/writes state under `sharedState[stateKey]` instead
 * of the root state. Tool calls from the child are namespaced and scoped.
 *
 * Usage:
 *   import chatExp from "@vibevibes/chat";
 *
 *   function Canvas(props) {
 *     return h('div', {},
 *       h(MyGameUI, props),
 *       h(EmbeddedExperience, {
 *         experience: chatExp,
 *         stateKey: "_chat",
 *         sharedState: props.sharedState,
 *         callTool: props.callTool,
 *         roomId: props.roomId,
 *         actorId: props.actorId,
 *         participants: props.participants,
 *         ephemeralState: props.ephemeralState,
 *         setEphemeral: props.setEphemeral,
 *         style: { position: 'absolute', bottom: 0, right: 0, width: 300, height: 400 },
 *       }),
 *     );
 *   }
 */
export function EmbeddedExperience(props: EmbeddedExperienceProps) {
  const React = getReact();
  const {
    experience,
    stateKey,
    sharedState,
    callTool,
    roomId,
    actorId,
    participants,
    ephemeralState,
    setEphemeral,
    roomConfig,
    style,
    className,
  } = props;

  // Scoped state: child sees sharedState[stateKey] as its root
  const childState = React.useMemo(
    () => (sharedState[stateKey] || {}) as Record<string, any>,
    [sharedState, stateKey],
  );

  // Scoped callTool: wraps tool calls to operate on the scoped state key
  const scopedCallTool = React.useCallback(
    async (name: string, input: any) => {
      // The tool handler will need to be scoped - this is handled by the parent
      // For now, we prefix the tool name to indicate scoping
      return callTool(`${stateKey}:${name}`, { ...input, _scopeKey: stateKey });
    },
    [callTool, stateKey],
  );

  // Scoped ephemeral
  const childEphemeral = React.useMemo(() => {
    const scoped: Record<string, Record<string, any>> = {};
    for (const [actId, data] of Object.entries(ephemeralState)) {
      if (data[stateKey]) {
        scoped[actId] = data[stateKey];
      }
    }
    return scoped;
  }, [ephemeralState, stateKey]);

  const scopedSetEphemeral = React.useCallback(
    (data: Record<string, any>) => {
      setEphemeral({ [stateKey]: data });
    },
    [setEphemeral, stateKey],
  );

  // Render child Canvas inside a container div
  const ChildCanvas = experience.Canvas;
  return h('div', { style, className },
    h(ChildCanvas, {
      roomId,
      actorId,
      sharedState: childState,
      callTool: scopedCallTool,
      ephemeralState: childEphemeral,
      setEphemeral: scopedSetEphemeral,
      participants,
      roomConfig: roomConfig || {},
    }),
  );
}
