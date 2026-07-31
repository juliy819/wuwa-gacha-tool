import { useCallback, RefObject } from 'react';

/**
 * 按钮点击波纹效果。在目标元素上调用返回的 createRipple(e) 即可。
 * 元素需添加 `click-ripple` class（提供 overflow:hidden + 定位上下文）。
 * 不传 containerRef 时自动使用 e.currentTarget。
 */
export function useClickRipple(containerRef?: RefObject<HTMLElement | null>) {
  const createRipple = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const container = containerRef?.current ?? e.currentTarget;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const size = Math.max(rect.width, rect.height) * 2;

    const ripple = document.createElement('span');
    ripple.className = 'ripple-wave';
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${x - size / 2}px`;
    ripple.style.top = `${y - size / 2}px`;

    container.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  }, [containerRef]);

  return createRipple;
}
