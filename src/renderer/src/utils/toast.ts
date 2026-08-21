// P1-11: Toast utility built on naive-ui createDiscreteApi
// Provides showToast(message, type, duration?) for global toast notifications.
// UI-REDESIGN v0.3: + showActionToast() with clickable action buttons
//                    (used for permission-related error guidance)

import { createDiscreteApi, type MessageApiInjection, type NotificationApiInjection } from 'naive-ui'
import type { MessageReactive } from 'naive-ui'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export const MAX_TOASTS = 3
export const DEFAULT_DURATION = 3000
export const TOAST_Z_INDEX = 2000

// 懒初始化，避免模块顶层调用 createDiscreteApi 导致 Electron 环境下白屏
let messageApi: MessageApiInjection | null = null
let notificationApi: NotificationApiInjection | null = null

function getDiscreteApis(): {
  message: MessageApiInjection
  notification: NotificationApiInjection
} {
  if (!messageApi || !notificationApi) {
    const { message, notification } = createDiscreteApi(['message', 'notification'], {
      messageProviderProps: {
        max: MAX_TOASTS,
        duration: DEFAULT_DURATION,
        containerStyle: {
          zIndex: TOAST_Z_INDEX,
        },
      },
      notificationProviderProps: {
        max: 3,
        placement: 'bottom-right',
        containerStyle: {
          zIndex: TOAST_Z_INDEX,
        },
      },
    })
    messageApi = message
    notificationApi = notification
  }
  return { message: messageApi, notification: notificationApi }
}

function getMessageApi(): MessageApiInjection {
  return getDiscreteApis().message
}

/**
 * Show a toast notification.
 *
 * @param message - Toast text content
 * @param type - Toast type, defaults to 'info'
 * @param duration - Display duration in ms, defaults to 3000
 */
export function showToast(
  message: string,
  type: ToastType = 'info',
  duration: number = DEFAULT_DURATION,
): void {
  getMessageApi()[type](message, { duration })
}

// ─── Action toast (UI-REDESIGN v0.3) ────────────────────────────

export interface ActionToastOptions {
  title: string
  description?: string
  type?: ToastType
  /** Duration in ms; 0 means sticky until dismissed */
  duration?: number
  /** Clickable actions rendered as buttons under the description */
  actions?: Array<{
    label: string
    onClick: () => void
  }>
}

/**
 * Show a notification toast with optional action buttons.
 * Used for permission-related errors where the user needs a
 * clear path to resolution (e.g. "打开设置", "查看文档").
 *
 * Returns the reactive message instance (or null on failure).
 */
export function showActionToast(options: ActionToastOptions): MessageReactive | null {
  const { notification } = getDiscreteApis()
  const type = options.type ?? 'info'
  const duration = options.duration ?? 6000

  const notificationTypeMap = {
    success: 'success',
    error: 'error',
    warning: 'warning',
    info: 'info',
  } as const

  try {
    const reactive = notification[notificationTypeMap[type]]({
      title: options.title,
      content: options.description ?? '',
      duration: duration === 0 ? undefined : duration,
      closable: true,
      action: options.actions?.length
        ? () => {
            const container = document.createElement('div')
            container.className = 'af-toast-actions'
            for (const action of options.actions ?? []) {
              const btn = document.createElement('button')
              btn.textContent = action.label
              btn.className = 'af-toast-actions__btn'
              btn.addEventListener('click', () => {
                action.onClick()
                reactive?.destroy()
              })
              container.appendChild(btn)
            }
            return container
          }
        : undefined,
    })
    return reactive ?? null
  } catch {
    // Fallback to plain toast if notification API fails
    showToast(options.title, type)
    return null
  }
}
