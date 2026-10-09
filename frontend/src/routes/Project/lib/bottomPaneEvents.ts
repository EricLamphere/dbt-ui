import type { ImpactMode } from './impactChanges';

/**
 * Lets components outside the bottom pane (e.g. the SidePane's impact card or
 * the Git page banner) open it on a specific tab. BottomPane owns its
 * open/tab state, so this is a window event rather than lifted state.
 */
export const OPEN_BOTTOM_TAB_EVENT = 'dbt-ui:open-bottom-tab';

export type BottomTabRequest = 'impact' | 'node-dag';

export interface OpenBottomTabDetail {
  tab: BottomTabRequest;
  /** For the Impact tab: which source to show. */
  impactMode?: ImpactMode;
}

export function openBottomTab(tab: BottomTabRequest, options: { impactMode?: ImpactMode } = {}): void {
  window.dispatchEvent(new CustomEvent<OpenBottomTabDetail>(OPEN_BOTTOM_TAB_EVENT, { detail: { tab, ...options } }));
}
