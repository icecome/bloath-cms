import { z } from 'zod';
import { isInternalHostname } from './security';

export function isPublicWebHost(hostname: string): boolean {
  return !isInternalHostname(hostname);
}

const createMessageSchema = z.object({
  visitor_name: z.string().min(1, '昵称不能为空').max(20, '昵称不能超过20个字符'),
  visitor_email: z
    .union([
      z.string().max(100, '邮箱不能超过100个字符').email({ message: '邮箱格式不正确' }),
      z.literal(''),
    ])
    .optional()
    .default(''),
  content: z.string().min(1, '留言内容不能为空').max(500, '留言内容不能超过500个字符'),
  quoted_text: z.string().max(500, '引用内容不能超过500个字符').optional().default(''),
  page_url: z
    .string()
    .url('页面URL格式不正确')
    .max(500, '页面URL不能超过500个字符')
    .refine((val) => /^https?:\/\//.test(val), { message: '页面URL仅支持 http/https 协议' }),
  visitor_website: z
    .string()
    .max(200, '站点地址不能超过200个字符')
    .optional()
    .default('')
    .refine(
      (val) => {
        if (!val) return true;
        if (!/^https?:\/\/[^\s]+\.[^\s]+/.test(val)) return false;
        try { return isPublicWebHost(new URL(val).hostname); } catch { return false; }
      },
      { message: '站点地址格式不正确' }
    ),
  page_title: z.string().min(1, '页面标题不能为空').max(200, '页面标题不能超过200个字符'),
  turnstile_token: z.string().optional().default(''),
  cf_verified: z.boolean(),
});

export type CreateMessageInput = z.infer<typeof createMessageSchema>;

export function validateCreateMessage(data: unknown): CreateMessageInput {
  return createMessageSchema.parse(data);
}
