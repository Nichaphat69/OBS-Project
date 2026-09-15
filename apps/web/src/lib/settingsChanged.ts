/** Custom window event so open pages reading /api/settings can refetch right after the
 * FlowAccount toggle in AppShell.tsx changes it — same pattern as notifRead.ts's
 * NOTIF_READ_EVENT (client-side state changed outside React, no SSE signal for it). */
export const SETTINGS_CHANGED_EVENT = 'obs:settingschanged';
