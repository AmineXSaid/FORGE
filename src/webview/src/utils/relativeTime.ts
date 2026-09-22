/**
 * A session row's age, in the official's compact units.
 *
 * Its `K95`, floor for floor:
 *
 *   let Z=Date.now()-$,Y=Math.floor(Z/1000),X=Math.floor(Y/60),Q=Math.floor(X/60),
 *       G=Math.floor(Q/24),z=Math.floor(G/30),q=Math.floor(G/365);
 *   if(q>0)return`${q}y`; if(z>0)return`${z}mo`; if(G>0)return`${G}d`;
 *   if(Q>0)return`${Q}h`; if(X>0)return`${X}m`; return"now"
 *
 * What `SessionsPage.vue` had before was a different function in a different
 * language: `刚刚` / `分钟前` / `天前`, rounded rather than floored, and falling
 * back to a `zh-CN` date after a week. In an English UI it read as a rendering
 * bug, and it is the text on every row of the list the activity bar now opens.
 *
 * Floor, not round, is the part worth keeping: rounding shows "2h" thirty-one
 * minutes in, so a conversation you just left claims to be hours old.
 *
 * Its own module rather than a function inside the SFC, because `<script setup>`
 * cannot export and a formatter with six boundaries deserves a spec.
 */
export function formatRelativeTime(input?: number | string | Date): string {
  if (input === undefined || input === null) return 'now';
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return 'now';

  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  // The official's own approximations: every month is 30 days, every year 365.
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) return `${years}y`;
  if (months > 0) return `${months}mo`;
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return 'now';
}
