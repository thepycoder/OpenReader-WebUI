'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@headlessui/react';
import toast from 'react-hot-toast';
import {
  AbbreviationEntry,
  getAllAbbreviations,
  addAbbreviation,
  updateAbbreviation,
  deleteAbbreviation,
  exportAbbreviations,
  importAbbreviations,
  resetToDefaults,
  updateAbbreviationsOrder,
  clearAbbreviationsCache
} from '@/utils/abbreviations';

interface AbbreviationsManagerProps {
  isOpen: boolean;
}

interface DragState {
  draggedId: string | null;
  dragOverId: string | null;
}

export function AbbreviationsManager({ isOpen }: AbbreviationsManagerProps) {
  const [abbreviations, setAbbreviations] = useState<AbbreviationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAbbreviation, setNewAbbreviation] = useState('');
  const [newExpansion, setNewExpansion] = useState('');
  const [newIsRegex, setNewIsRegex] = useState(false);
  const [editAbbreviation, setEditAbbreviation] = useState('');
  const [editExpansion, setEditExpansion] = useState('');
  const [editIsRegex, setEditIsRegex] = useState(false);
  const [dragState, setDragState] = useState<DragState>({ draggedId: null, dragOverId: null });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load abbreviations when component mounts or opens
  useEffect(() => {
    if (isOpen) {
      loadAbbreviations();
    }
  }, [isOpen]);

  const loadAbbreviations = async () => {
    try {
      setLoading(true);
      const data = await getAllAbbreviations();
      setAbbreviations(data);
    } catch (error) {
      console.error('Error loading abbreviations:', error);
      toast.error('Failed to load abbreviations', {
        style: { background: 'var(--background)', color: 'var(--accent)' }
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDragStart = (e: React.DragEvent, abbreviationId: string) => {
    setDragState({ draggedId: abbreviationId, dragOverId: null });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, abbreviationId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragState(prev => ({ ...prev, dragOverId: abbreviationId }));
  };

  const handleDragLeave = () => {
    setDragState(prev => ({ ...prev, dragOverId: null }));
  };

  const handleDrop = async (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const { draggedId } = dragState;
    
    if (!draggedId || draggedId === targetId) {
      setDragState({ draggedId: null, dragOverId: null });
      return;
    }

    try {
      // Find the indices
      const draggedIndex = abbreviations.findIndex(abbr => abbr.id === draggedId);
      const targetIndex = abbreviations.findIndex(abbr => abbr.id === targetId);
      
      if (draggedIndex === -1 || targetIndex === -1) return;

      // Create new order
      const newAbbreviations = [...abbreviations];
      const [draggedItem] = newAbbreviations.splice(draggedIndex, 1);
      newAbbreviations.splice(targetIndex, 0, draggedItem);

      // Update local state first for immediate visual feedback
      setAbbreviations(newAbbreviations);

      // Update order in database
      const orderedIds = newAbbreviations.map(abbr => abbr.id);
      await updateAbbreviationsOrder(orderedIds);
      
      // Clear cache so the changes take effect immediately
      clearAbbreviationsCache();
      
      toast.success('Abbreviations reordered', {
        style: { background: 'var(--background)', color: 'var(--accent)' }
      });
    } catch (error) {
      console.error('Error reordering abbreviations:', error);
      toast.error('Failed to reorder abbreviations', {
        style: { background: 'var(--background)', color: 'var(--accent)' }
      });
      // Reload to restore correct order
      await loadAbbreviations();
    }

    setDragState({ draggedId: null, dragOverId: null });
  };

  const handleDragEnd = () => {
    setDragState({ draggedId: null, dragOverId: null });
  };

  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    try {
      await updateAbbreviation(id, { enabled });
      setAbbreviations(prev => 
        prev.map(abbr => abbr.id === id ? { ...abbr, enabled } : abbr)
      );
      // Clear cache so the changes take effect immediately
      clearAbbreviationsCache();
      toast.success(`Abbreviation ${enabled ? 'enabled' : 'disabled'}`, {
        style: { background: 'var(--background)', color: 'var(--accent)' }
      });
    } catch (error) {
      console.error('Error updating abbreviation:', error);
      toast.error('Failed to update abbreviation', {
        style: { background: 'var(--background)', color: 'var(--accent)' }
      });
    }
  };

  const handleToggleRegex = async (id: string, isRegex: boolean) => {
    try {
      await updateAbbreviation(id, { isRegex });
      setAbbreviations(prev => 
        prev.map(abbr => abbr.id === id ? { ...abbr, isRegex } : abbr)
      );
      // Clear cache so the changes take effect immediately
      clearAbbreviationsCache();
      toast.success(`Abbreviation updated to ${isRegex ? 'regex' : 'literal'} mode`, {
        style: { background: 'var(--background)', color: 'var(--accent)' }
      });
    } catch (error) {
      console.error('Error updating abbreviation regex flag:', error);
      toast.error('Failed to update abbreviation', {
        style: { background: 'var(--background)', color: 'var(--accent)' }
      });
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAbbreviation.trim() || !newExpansion.trim()) {
      toast.error('Please fill in both fields', {
        style: { background: 'var(--background)', color: 'var(--accent)' }
      });
      return;
    }

    try {
      await addAbbreviation(newAbbreviation, newExpansion, newIsRegex);
      // Reload abbreviations to get the updated list
      await loadAbbreviations();
      // Clear cache so the changes take effect immediately
      clearAbbreviationsCache();
      setNewAbbreviation('');
      setNewExpansion('');
      setNewIsRegex(false);
      setShowAddForm(false);
      toast.success('Abbreviation added successfully', {
        style: { background: 'var(--background)', color: 'var(--accent)' }
      });
    } catch (error) {
      console.error('Error adding abbreviation:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to add abbreviation', {
        style: { background: 'var(--background)', color: 'var(--accent)' }
      });
    }
  };

  const handleStartEdit = (abbr: AbbreviationEntry) => {
    setEditingId(abbr.id);
    setEditAbbreviation(abbr.abbreviation);
    setEditExpansion(abbr.expansion);
    setEditIsRegex(abbr.isRegex ?? false);
  };

  const handleSaveEdit = async () => {
    if (!editAbbreviation.trim() || !editExpansion.trim()) {
      toast.error('Please fill in both fields', {
        style: { background: 'var(--background)', color: 'var(--accent)' }
      });
      return;
    }

    try {
      await updateAbbreviation(editingId!, {
        abbreviation: editAbbreviation,
        expansion: editExpansion,
        isRegex: editIsRegex
      });
      setAbbreviations(prev =>
        prev.map(abbr =>
          abbr.id === editingId
            ? { ...abbr, abbreviation: editAbbreviation, expansion: editExpansion, isRegex: editIsRegex }
            : abbr
        )
      );
      // Clear cache so the changes take effect immediately
      clearAbbreviationsCache();
      setEditingId(null);
      toast.success('Abbreviation updated successfully', {
        style: { background: 'var(--background)', color: 'var(--accent)' }
      });
    } catch (error) {
      console.error('Error updating abbreviation:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to update abbreviation', {
        style: { background: 'var(--background)', color: 'var(--accent)' }
      });
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditAbbreviation('');
    setEditExpansion('');
    setEditIsRegex(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this abbreviation?')) {
      return;
    }

    try {
      await deleteAbbreviation(id);
      setAbbreviations(prev => prev.filter(abbr => abbr.id !== id));
      // Clear cache so the changes take effect immediately
      clearAbbreviationsCache();
      toast.success('Abbreviation deleted successfully', {
        style: { background: 'var(--background)', color: 'var(--accent)' }
      });
    } catch (error) {
      console.error('Error deleting abbreviation:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete abbreviation', {
        style: { background: 'var(--background)', color: 'var(--accent)' }
      });
    }
  };

  const handleExport = async () => {
    try {
      const exportData = await exportAbbreviations();
      const blob = new Blob([exportData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `abbreviations-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 100);

      toast.success('Abbreviations exported successfully', {
        style: { background: 'var(--background)', color: 'var(--accent)' }
      });
    } catch (error) {
      console.error('Error exporting abbreviations:', error);
      toast.error('Failed to export abbreviations', {
        style: { background: 'var(--background)', color: 'var(--accent)' }
      });
    }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const result = await importAbbreviations(text);
      
      await loadAbbreviations(); // Reload to show imported data
      // Clear cache so the changes take effect immediately
      clearAbbreviationsCache();
      
      let message = `Import completed: ${result.imported} new, ${result.updated} updated`;
      if (result.errors.length > 0) {
        message += `, ${result.errors.length} errors`;
        console.warn('Import errors:', result.errors);
      }
      
      toast.success(message, {
        style: { background: 'var(--background)', color: 'var(--accent)' },
        duration: 5000
      });
    } catch (error) {
      console.error('Error importing abbreviations:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to import abbreviations', {
        style: { background: 'var(--background)', color: 'var(--accent)' }
      });
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleReset = async () => {
    if (!confirm('Are you sure you want to clear all abbreviations? This action cannot be undone.')) {
      return;
    }

    try {
      await resetToDefaults();
      await loadAbbreviations();
      // Clear cache so the changes take effect immediately
      clearAbbreviationsCache();
      toast.success('All abbreviations cleared', {
        style: { background: 'var(--background)', color: 'var(--accent)' }
      });
    } catch (error) {
      console.error('Error clearing abbreviations:', error);
      toast.error('Failed to clear abbreviations', {
        style: { background: 'var(--background)', color: 'var(--accent)' }
      });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-muted">Loading abbreviations...</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
        <div>
          <h3 className="text-sm font-medium text-foreground">TTS Abbreviations</h3>
          <p className="text-xs text-muted">Manage text-to-speech abbreviation expansions</p>
          <p className="text-xs text-warning mt-1">⚠️ Order matters: top items are processed first (important when abbreviations contain each other)</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => setShowAddForm(!showAddForm)}
            className="text-xs px-2 py-1 bg-accent text-background rounded hover:opacity-90 transition-opacity"
          >
            {showAddForm ? 'Cancel' : 'Add New'}
          </Button>
          <Button
            onClick={handleExport}
            className="text-xs px-2 py-1 bg-background text-foreground border border-muted rounded hover:bg-offbase transition-colors"
          >
            Export
          </Button>
          <Button
            onClick={() => fileInputRef.current?.click()}
            className="text-xs px-2 py-1 bg-background text-foreground border border-muted rounded hover:bg-offbase transition-colors"
          >
            Import
          </Button>
          <Button
            onClick={handleReset}
            className="text-xs px-2 py-1 bg-warning text-background rounded hover:opacity-90 transition-opacity"
          >
            Clear All
          </Button>
        </div>
      </div>

      {/* Hidden file input for import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleImport}
        className="hidden"
      />

      {/* Add new form */}
      {showAddForm && (
        <form onSubmit={handleAdd} className="bg-offbase p-3 rounded-lg space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Abbreviation (e.g., Dr. or \\d+)"
              value={newAbbreviation}
              onChange={(e) => setNewAbbreviation(e.target.value)}
              className="px-2 py-1 text-xs bg-background border border-muted rounded focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <input
              type="text"
              placeholder="Expansion (e.g., Doctor or $&)"
              value={newExpansion}
              onChange={(e) => setNewExpansion(e.target.value)}
              className="px-2 py-1 text-xs bg-background border border-muted rounded focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-foreground">
              <input
                type="checkbox"
                checked={newIsRegex}
                onChange={(e) => setNewIsRegex(e.target.checked)}
                className="w-3 h-3 text-accent rounded border-muted focus:ring-1 focus:ring-accent"
              />
              Regex Pattern
            </label>
            <span className="text-xs text-muted">
              {newIsRegex ? 'Pattern will be used as regex (e.g., \\d+ for digits)' : 'Text will be matched literally'}
            </span>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-xs px-2 py-1 text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="text-xs px-3 py-1 bg-accent text-background rounded hover:opacity-90 transition-opacity"
            >
              Add
            </Button>
          </div>
        </form>
      )}

      {/* Abbreviations list */}
      <div className="max-h-64 overflow-y-auto space-y-1">
        {abbreviations.map((abbr, index) => (
          <div
            key={abbr.id}
            draggable
            onDragStart={(e) => handleDragStart(e, abbr.id)}
            onDragOver={(e) => handleDragOver(e, abbr.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, abbr.id)}
            onDragEnd={handleDragEnd}
            className={`flex items-center gap-2 p-2 rounded cursor-move transition-all ${
              abbr.enabled ? 'bg-background' : 'bg-offbase opacity-60'
            } ${
              dragState.draggedId === abbr.id ? 'opacity-50 scale-95' : ''
            } ${
              dragState.dragOverId === abbr.id ? 'ring-2 ring-accent' : ''
            }`}
          >
            {/* Drag handle */}
            <div className="text-xs text-muted cursor-move flex flex-col">
              <span className="select-none">⋮⋮</span>
            </div>

            {/* Order indicator */}
            <div className="text-xs text-muted bg-offbase px-1 rounded min-w-[20px] text-center">
              {index + 1}
            </div>

            {/* Enable/disable toggle */}
            <input
              type="checkbox"
              checked={abbr.enabled}
              onChange={(e) => handleToggleEnabled(abbr.id, e.target.checked)}
              className="w-3 h-3 text-accent rounded border-muted focus:ring-1 focus:ring-accent"
              title="Enable/disable abbreviation"
            />

            {/* Regex toggle */}
            <div 
              className={`text-xs px-1 rounded font-mono border cursor-pointer transition-colors ${
                abbr.isRegex 
                  ? 'bg-accent text-background border-accent' 
                  : 'bg-background text-muted border-muted hover:border-accent'
              }`}
              onClick={() => handleToggleRegex(abbr.id, !abbr.isRegex)}
              title={abbr.isRegex ? 'Switch to literal text' : 'Switch to regex pattern'}
            >
              {abbr.isRegex ? 'RX' : 'LT'}
            </div>

            {/* Abbreviation and expansion */}
            {editingId === abbr.id ? (
              <>
                <input
                  type="text"
                  value={editAbbreviation}
                  onChange={(e) => setEditAbbreviation(e.target.value)}
                  className="flex-1 px-2 py-1 text-xs bg-background border border-muted rounded focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <span className="text-xs text-muted">→</span>
                <input
                  type="text"
                  value={editExpansion}
                  onChange={(e) => setEditExpansion(e.target.value)}
                  className="flex-1 px-2 py-1 text-xs bg-background border border-muted rounded focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <label className="flex items-center gap-1 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={editIsRegex}
                    onChange={(e) => setEditIsRegex(e.target.checked)}
                    className="w-3 h-3 text-accent rounded border-muted focus:ring-1 focus:ring-accent"
                  />
                  RX
                </label>
                <div className="flex gap-1">
                  <Button
                    onClick={handleSaveEdit}
                    className="text-xs px-2 py-1 bg-accent text-background rounded hover:opacity-90 transition-opacity"
                  >
                    Save
                  </Button>
                  <Button
                    onClick={handleCancelEdit}
                    className="text-xs px-2 py-1 text-muted hover:text-foreground transition-colors"
                  >
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <>
                <span className={`flex-1 text-xs font-mono ${abbr.isRegex ? 'text-accent' : 'text-foreground'}`}>
                  {abbr.abbreviation}
                </span>
                <span className="text-xs text-muted">→</span>
                <span className="flex-1 text-xs text-foreground">
                  {abbr.expansion}
                </span>
                <div className="flex gap-1">
                  <Button
                    onClick={() => handleStartEdit(abbr)}
                    className="text-xs px-2 py-1 text-muted hover:text-foreground transition-colors"
                  >
                    Edit
                  </Button>
                  <Button
                    onClick={() => handleDelete(abbr.id)}
                    className="text-xs px-2 py-1 text-error hover:bg-error hover:text-background transition-colors"
                  >
                    Delete
                  </Button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {abbreviations.length === 0 && (
        <div className="text-center py-8 text-muted">
          <p className="text-sm">No abbreviations found</p>
          <p className="text-xs mt-1">Add some abbreviations or import from a file</p>
        </div>
      )}

      {/* Stats */}
      <div className="text-xs text-muted text-center pt-2 border-t border-muted">
        {abbreviations.length} total ({abbreviations.filter(a => a.enabled).length} enabled)
      </div>
    </div>
  );
}