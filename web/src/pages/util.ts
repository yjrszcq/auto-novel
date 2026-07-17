import { useBreakpoints } from '@vueuse/core';
import type { MessageApi } from 'naive-ui';

import { formatError } from '@/api';

export const useBreakPoints = () =>
  useBreakpoints({
    mobile: 0,
    tablet: 540,
    desktop: 1200,
  });

export const doAction = (
  promise: Promise<unknown>,
  label: string,
  message: MessageApi,
) =>
  promise
    .then(() => {
      message.info(label + '成功');
    })
    .catch(async (error) => {
      message.error(label + '失败:' + (await formatError(error)));
    });

export const copyToClipBoard = async (
  text: string,
  parentNode?: HTMLElement | null,
) => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}

  const textElement = document.createElement('div');
  textElement.innerText = text;
  Object.assign(textElement.style, {
    position: 'fixed',
    top: '-9999px',
    left: '-9999px',
    opacity: '0',
  });
  textElement.contentEditable = 'true';

  const targetNode = parentNode ?? document.body;
  targetNode.appendChild(textElement);

  try {
    const range = document.createRange();
    range.selectNodeContents(textElement);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    return document.execCommand('copy');
  } finally {
    targetNode.removeChild(textElement);
  }
};
