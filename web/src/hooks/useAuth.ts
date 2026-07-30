// 重导出：向后兼容现有 import { useAuth } from '../hooks/useAuth'
// 认证逻辑已迁移至 contexts/AuthContext.tsx（Context Provider 模式）
export { useAuth, type User } from '../contexts/AuthContext';
