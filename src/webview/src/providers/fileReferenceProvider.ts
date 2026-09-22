import type { DropdownItemType } from '../types/dropdown'
import type { RuntimeInstance } from '../composables/useRuntime'

/**
 * 文件引用项
 */
export interface FileReference {
  path: string
  name: string
  /**
   * Step 28: the host also lists open browser tabs here, as the official's
   * `findFiles` does (`type:"browser"`, `path:"browser:<group>:<id>:<url>"`).
   * Picking one writes an `@browser:…` mention the send path can resolve.
   */
  type: 'file' | 'directory' | 'browser'
}

/**
 * 获取文件列表
 * @param query 搜索查询
 * @param runtime Runtime 实例
 * @param signal 可选的 AbortSignal,用于取消请求
 * @returns 文件引用数组
 */
export async function getFileReferences(
  query: string,
  runtime: RuntimeInstance | undefined,
  signal?: AbortSignal
): Promise<FileReference[]> {
  if (!runtime) {
    console.warn('[fileReferenceProvider] No runtime available')
    return []
  }

  try {
    const connection = await runtime.connectionManager.get()

    // 空查询传递空字符串,让后端返回顶层内容（目录 + 顶层文件）
    const pattern = (query && query.trim()) ? query : ''
    const response = await connection.listFiles(pattern, signal)

    // response.files 格式：{ path, name, type }
    return response.files || []
  } catch (error) {
    // 如果是 AbortError,静默处理
    if (error instanceof Error && error.name === 'AbortError') {
      return []
    }
    console.error('[fileReferenceProvider] Failed to list files:', error)
    return []
  }
}

/**
 * 将文件引用转换为 DropdownItem 格式
 */
export function fileToDropdownItem(file: FileReference): DropdownItemType {
  return {
    id: `file-${file.path}`,
    type: 'item',
    label: file.name,
    // The official's browser row is icon + name + the literal trailing word
    // "browser" (index.js @4962200), not the mention path.
    detail: file.type === 'browser' ? 'browser' : file.path,
    // 不设置 icon，交由 FileIcon 组件根据 isDirectory/folderName 匹配
    data: {
      file
    }
  }
}
