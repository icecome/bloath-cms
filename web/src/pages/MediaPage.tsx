import { ImageIcon } from 'lucide-react';

export default function MediaPage() {
  return (
    <div className="flex-1 overflow-auto">
      {/* 顶部栏 */}
      <header className="px-8 py-5 flex-shrink-0">
        <h1 className="text-base font-medium text-[#1F1F1F]">媒体库</h1>
        <p className="text-sm text-[#6B7280] mt-1">管理图片和静态资源</p>
      </header>

      <div className="px-8">
        <div className="border border-[#E8E8E8] rounded-sm p-12 text-center">
          <ImageIcon className="w-10 h-10 text-[#9CA3AF] mx-auto mb-3" />
          <p className="text-sm text-[#6B7280] mb-1">功能待完善</p>
          <p className="text-xs text-[#9CA3AF]">图片上传与管理功能将在后续版本中添加</p>
        </div>
      </div>
    </div>
  );
}
