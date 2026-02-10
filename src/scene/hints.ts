/**
 * Pre-built agent hints for scene interaction.
 * Optional — experience authors can include these or define their own.
 */

import type { AgentHint } from '../types';

export function createSceneHints(namespace: string): AgentHint[] {
  return [
    {
      trigger: 'Scene is empty and a participant joined',
      condition: `(state._scene?.root?.children?.length ?? 0) === 0`,
      suggestedTools: [`${namespace}.add`, `${namespace}.set`],
      priority: 'medium',
      cooldownMs: 10000,
    },
    {
      trigger: 'A participant interacted with a scene node',
      suggestedTools: [`${namespace}.update`],
      priority: 'high',
      cooldownMs: 2000,
    },
    {
      trigger: 'Scene has entities but no gradients defined — visual quality opportunity',
      condition: `(state._scene?.root?.children?.length ?? 0) > 3 && (state._scene?.gradients?.length ?? 0) === 0`,
      suggestedTools: [`${namespace}.set`],
      priority: 'medium',
      cooldownMs: 30000,
    },
  ];
}
