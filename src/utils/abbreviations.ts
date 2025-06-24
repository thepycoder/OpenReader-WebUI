/**
 * Abbreviations Management Utility
 * 
 * This module provides functionality to manage custom abbreviations for TTS preprocessing.
 * It handles loading, saving, importing, and exporting abbreviations to/from IndexedDB.
 */

import { indexedDBService } from '@/utils/indexedDB';

/**
 * Represents a single abbreviation entry
 */
export interface AbbreviationEntry {
  id: string;
  abbreviation: string;
  expansion: string;
  enabled: boolean;
  isRegex: boolean; // Whether this abbreviation should be treated as a regex pattern
  createdAt: Date;
  order: number; // Higher numbers = higher priority (processed first)
}

/**
 * Configuration for exporting/importing abbreviations
 */
export interface AbbreviationsExport {
  version: string;
  exportedAt: string;
  abbreviations: Array<{
    abbreviation: string;
    expansion: string;
    enabled: boolean;
    isRegex?: boolean; // Optional for backwards compatibility
  }>;
}

// Configuration key for storing abbreviations in IndexedDB
const ABBREVIATIONS_CONFIG_KEY = 'custom_abbreviations';

/**
 * Generates a unique ID for an abbreviation entry
 */
function generateId(): string {
  return `abbr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Load abbreviations from storage with backwards compatibility
 */
async function loadAbbreviations(): Promise<AbbreviationEntry[]> {
  try {
    const data = await indexedDBService.getConfigItem(ABBREVIATIONS_CONFIG_KEY);
    if (!data) {
      return [];
    }
    
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) {
      return [];
    }
    
    // Add backwards compatibility for existing abbreviations without isRegex property
    return parsed.map(abbr => ({
      ...abbr,
      isRegex: abbr.isRegex ?? false // Default to false for backwards compatibility
    }));
  } catch (error) {
    console.error('Error loading abbreviations:', error);
    return [];
  }
}

/**
 * Save abbreviations to storage
 */
async function saveAbbreviationsToStorage(abbreviations: AbbreviationEntry[]): Promise<void> {
  try {
    await indexedDBService.setConfigItem(ABBREVIATIONS_CONFIG_KEY, JSON.stringify(abbreviations));
  } catch (error) {
    console.error('Error saving abbreviations:', error);
    throw new Error('Failed to save abbreviations');
  }
}

/**
 * Get all abbreviations
 */
export async function getAllAbbreviations(): Promise<AbbreviationEntry[]> {
  try {
    const abbreviations = await loadAbbreviations();
    // Sort by order (highest order first - most recent/important first)
    return abbreviations.sort((a, b) => (b.order || 0) - (a.order || 0));
  } catch (error) {
    console.error('Error getting all abbreviations:', error);
    return [];
  }
}

/**
 * Save abbreviations
 */
export async function saveAbbreviations(abbreviations: AbbreviationEntry[]): Promise<void> {
  await saveAbbreviationsToStorage(abbreviations);
}

/**
 * Add a new abbreviation
 */
export async function addAbbreviation(abbreviation: string, expansion: string, isRegex = false): Promise<void> {
  
  if (!abbreviation || !expansion) {
    throw new Error('Abbreviation and expansion cannot be empty');
  }
  
  const allAbbreviations = await getAllAbbreviations();
  
  // Check for duplicates (case-insensitive)
  const exists = allAbbreviations.some(
    abbr => abbr.abbreviation.toLowerCase() === abbreviation.toLowerCase()
  );
  
  if (exists) {
    throw new Error('Abbreviation already exists');
  }
  
  const newEntry: AbbreviationEntry = {
    id: generateId(),
    abbreviation: abbreviation,
    expansion: expansion,
    enabled: true,
    isRegex: isRegex,
    createdAt: new Date(),
    order: await getNextOrderValue()
  };
  
  allAbbreviations.push(newEntry);
  await saveAbbreviations(allAbbreviations);
}

/**
 * Update an existing abbreviation
 */
export async function updateAbbreviation(
  id: string, 
  updates: Partial<Pick<AbbreviationEntry, 'abbreviation' | 'expansion' | 'enabled' | 'isRegex'>>
): Promise<void> {
  const allAbbreviations = await getAllAbbreviations();
  const index = allAbbreviations.findIndex(abbr => abbr.id === id);
  
  if (index === -1) {
    throw new Error('Abbreviation not found');
  }
  
  const abbreviation = allAbbreviations[index];
  
  // If updating abbreviation text, check for duplicates
  if (updates.abbreviation && updates.abbreviation !== abbreviation.abbreviation) {
    if (!updates.abbreviation) {
      throw new Error('Abbreviation cannot be empty');
    }
    
    const exists = allAbbreviations.some(
      (abbr, idx) => idx !== index && abbr.abbreviation.toLowerCase() === updates.abbreviation!.toLowerCase()
    );
    
    if (exists) {
      throw new Error('Abbreviation already exists');
    }
  }
  
  // Apply updates
  Object.assign(abbreviation, updates);
  
  await saveAbbreviations(allAbbreviations);
}

/**
 * Delete an abbreviation
 */
export async function deleteAbbreviation(id: string): Promise<void> {
  const allAbbreviations = await getAllAbbreviations();
  const filtered = allAbbreviations.filter(abbr => abbr.id !== id);
  
  if (filtered.length === allAbbreviations.length) {
    throw new Error('Abbreviation not found');
  }
  
  await saveAbbreviations(filtered);
}

/**
 * Get enabled abbreviations as a map for TTS processing
 * Returns them in order (highest order first) for proper replacement sequence
 * Now includes regex flag information
 */
export async function getEnabledAbbreviationsMap(): Promise<Map<string, { expansion: string; isRegex: boolean }>> {
  const allAbbreviations = await getAllAbbreviations();
  const enabledMap = new Map<string, { expansion: string; isRegex: boolean }>();
  
  // Abbreviations are already sorted by order (highest first) from getAllAbbreviations
  allAbbreviations.forEach(abbr => {
    if (abbr.enabled) {
      enabledMap.set(abbr.abbreviation, { 
        expansion: abbr.expansion, 
        isRegex: abbr.isRegex ?? false // Default to false for backwards compatibility
      });
    }
  });
  
  return enabledMap;
}

/**
 * Export abbreviations to JSON format
 */
export async function exportAbbreviations(): Promise<string> {
  const allAbbreviations = await getAllAbbreviations();
  
  const exportData = allAbbreviations.map(abbr => ({
    abbreviation: abbr.abbreviation,
    expansion: abbr.expansion,
    enabled: abbr.enabled,
    isRegex: abbr.isRegex ?? false
  }));
  
  const exportObject: AbbreviationsExport = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    abbreviations: exportData
  };
  
  return JSON.stringify(exportObject, null, 2);
}

/**
 * Import abbreviations from JSON format
 */
export async function importAbbreviations(jsonData: string): Promise<{ imported: number; updated: number; errors: string[] }> {
  try {
    const parsed = JSON.parse(jsonData);
    
    if (!parsed.abbreviations || !Array.isArray(parsed.abbreviations)) {
      throw new Error('Invalid export format');
    }
    
    const allAbbreviations = await getAllAbbreviations();
    const results = { imported: 0, updated: 0, errors: [] as string[] };
    
    for (const importEntry of parsed.abbreviations) {
      try {
        if (!importEntry.abbreviation || !importEntry.expansion) {
          results.errors.push(`Skipped invalid entry: missing abbreviation or expansion`);
          continue;
        }
        
        const existing = allAbbreviations.find(
          abbr => abbr.abbreviation.toLowerCase() === importEntry.abbreviation.toLowerCase()
        );
        
        if (existing) {
          // Update existing
          existing.expansion = importEntry.expansion;
          existing.enabled = importEntry.enabled ?? true;
          existing.isRegex = importEntry.isRegex ?? false; // Default to false for backwards compatibility
          results.updated++;
        } else {
          // Add new
          const newEntry: AbbreviationEntry = {
            id: generateId(),
            abbreviation: importEntry.abbreviation,
            expansion: importEntry.expansion,
            enabled: importEntry.enabled ?? true,
            isRegex: importEntry.isRegex ?? false, // Default to false for backwards compatibility
            createdAt: new Date(),
            order: await getNextOrderValue()
          };
          allAbbreviations.push(newEntry);
          results.imported++;
        }
      } catch (error) {
        results.errors.push(`Error processing "${importEntry.abbreviation}": ${error}`);
      }
    }
    
    await saveAbbreviations(allAbbreviations);
    return results;
  } catch (error) {
    throw new Error(`Import failed: ${error}`);
  }
}

/**
 * Reset abbreviations (clear all)
 */
export async function resetToDefaults(): Promise<void> {
  try {
    await indexedDBService.removeConfigItem(ABBREVIATIONS_CONFIG_KEY);
  } catch (error) {
    console.error('Error resetting abbreviations:', error);
    throw new Error('Failed to reset abbreviations');
  }
}

/**
 * Get the next order value for new abbreviations
 */
async function getNextOrderValue(): Promise<number> {
  try {
    const allAbbreviations = await getAllAbbreviations();
    const maxOrder = Math.max(0, ...allAbbreviations.map(a => a.order || 0));
    return maxOrder + 1;
  } catch (error) {
    console.error('Error getting next order value:', error);
    return 1;
  }
}

/**
 * Update the order of abbreviations
 */
export async function updateAbbreviationsOrder(orderedIds: string[]): Promise<void> {
  const allAbbreviations = await getAllAbbreviations();
  
  // Update order based on new position (highest order = first in list)
  const maxOrder = orderedIds.length;
  orderedIds.forEach((id, index) => {
    const abbr = allAbbreviations.find(a => a.id === id);
    if (abbr) {
      abbr.order = maxOrder - index; // Reverse order so first item has highest order
    }
  });
  
  await saveAbbreviations(allAbbreviations);
}

/**
 * Clear any cached abbreviations in the TTS preprocessing system
 * This ensures changes to abbreviations take effect immediately
 */
export async function clearAbbreviationsCache(): Promise<void> {
  // Import and call the clear cache function from tts-preprocessing
  const { clearAbbreviationsCache: clearTTSCache } = await import('@/utils/tts-preprocessing');
  clearTTSCache();
}