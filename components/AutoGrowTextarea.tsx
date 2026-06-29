"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type TextareaHTMLAttributes,
} from "react";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Cap the auto-grow height (px); past it the field scrolls internally. */
  maxHeight?: number;
};

export const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, Props>(
  function AutoGrowTextarea({ className = "", value, maxHeight, ...rest }, ref) {
    const innerRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement);

    useEffect(() => {
      const el = innerRef.current;
      if (!el) return;
      el.style.height = "auto";
      const sh = el.scrollHeight;
      if (maxHeight && sh > maxHeight) {
        el.style.height = `${maxHeight}px`;
        el.style.overflowY = "auto";
      } else {
        el.style.height = `${sh}px`;
        el.style.overflowY = "hidden";
      }
    }, [value, maxHeight]);

    return (
      <textarea
        ref={innerRef}
        rows={1}
        value={value}
        className={`block w-full resize-none overflow-hidden bg-transparent leading-6 outline-none ${className}`}
        {...rest}
      />
    );
  },
);
