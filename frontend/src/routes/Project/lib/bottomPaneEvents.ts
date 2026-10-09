/**
 * Lets components outside the bottom pane (e.g. the SidePane's impact card)
 * open it on a specific tab. BottomPane owns its open/tab state, so this is a
 * window event rather than lifted state.
 */
export const OPEN_BOTTOM_TAB_EVENT = 'dbt-ui:open-bottom-tab';

export type BottomTabRequest = 'impact' | 'node-dag';

export function openBottomTab(tab: BottomTabRequest): void {
  window.dispatchEvent(new CustomEvent<BottomTabRequest>(OPEN_BOTTOM_TAB_EVENT, { detail: tab }));
}
