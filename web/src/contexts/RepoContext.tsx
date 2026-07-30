import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { getBranches } from '../lib/api';
import type { SelectedRepo } from '../../../shared/types';

interface RepoContextType {
  selectedRepo: SelectedRepo | null;
  setSelectedRepo: (repo: SelectedRepo | null) => void;
  branches: string[];
  loadingBranches: boolean;
  loadBranches: (owner: string, repo: string) => void;
}

const STORAGE_KEY = 'bloath_selected_repo';

const RepoContext = createContext<RepoContextType | undefined>(undefined);

function loadSavedRepo(): SelectedRepo | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function RepoProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [selectedRepo, setSelectedRepoState] = useState<SelectedRepo | null>(loadSavedRepo);
  const [branches, setBranches] = useState<string[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);

  const setSelectedRepo = useCallback((repo: SelectedRepo | null) => {
    setSelectedRepoState(repo);
    try {
      if (repo) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(repo));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // 隐私模式或存储已满，忽略持久化错误
    }
  }, []);

  const loadBranches = useCallback(async (owner: string, repo: string) => {
    setLoadingBranches(true);
    try {
      const branchList = await getBranches(owner, repo);
      setBranches(branchList);
    } catch (err) {
      console.error('加载分支失败:', err);
      setBranches(['main']);
    } finally {
      setLoadingBranches(false);
    }
  }, []);

  useEffect(() => {
    if (selectedRepo && user) {
      loadBranches(selectedRepo.owner, selectedRepo.repo);
    } else if (selectedRepo) {
      setBranches([]);
    }
  }, [selectedRepo, user, loadBranches]);

  return (
    <RepoContext.Provider value={{ selectedRepo, setSelectedRepo, branches, loadingBranches, loadBranches }}>
      {children}
    </RepoContext.Provider>
  );
}

export function useRepo() {
  const context = useContext(RepoContext);
  if (!context) {
    throw new Error('useRepo must be used within RepoProvider');
  }
  return context;
}
