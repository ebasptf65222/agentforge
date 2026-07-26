// P1-11: Toast utility built on naive-ui createDiscreteApi
// Provides showToast(message, type, duration?) for global toast notifications.

import { createDiscreteApi, type MessageApiInjection } from 'naive-ui'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export const MAX_TOASTS = 3
export const DEFAULT_DURATION = 3000
export const TOAST_Z_INDEX = 2000

const { message } = createDiscreteApi(['message'], {
  messageProviderProps: {
    max: MAX_TOASTS,
    duration: DEFAULT_DURATION,
    containerStyle: {
      zIndex: TOAST_Z_INDEX,
    },
  },
})

const messageApi: MessageApiInjection = message

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
  messageApi[type](message, { duration })
}
