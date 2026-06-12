/**
 * SettingsLayout.tsx — TWO CHANGES NEEDED
 * File: configure/src/components/SettingsLayout.tsx
 * 
 * ════════════════════════════════════════════════════════════════
 * CHANGE 1: Add the lazy import near the other lazy imports at top
 * ════════════════════════════════════════════════════════════════
 * 
 * Find this line:
 *   const LazyRatingPage = lazy(() => import('./RatingPage'));
 * 
 * ADD this line directly after it:
 */

const LazyMediaManager = lazy(() =>
  import('./sections/MediaManager').then((module) => ({ default: module.MediaManager }))
);

/**
 * ════════════════════════════════════════════════════════════════
 * CHANGE 2: Add to the settingsPages array
 * ════════════════════════════════════════════════════════════════
 * 
 * Find the settingsPages array:
 *   const settingsPages = [
 *     { value: 'presets', ... },
 *     ...
 *     { value: 'configuration', title: 'Configuration', ... },
 *   ] as const;
 * 
 * ADD this entry inside the array, BEFORE the closing ] as const;
 * (add it after the 'configuration' entry):
 */

  { value: 'media-manager', title: 'Media Manager', Component: LazyMediaManager, icon: Film },

/**
 * ════════════════════════════════════════════════════════════════
 * NOTE: Make sure Film is imported from lucide-react at the top.
 * It's already imported in SettingsLayout.tsx — check line:
 *   import { ..., Film, ... } from "lucide-react";
 * Film is already there so no extra import needed.
 * ════════════════════════════════════════════════════════════════
 */
