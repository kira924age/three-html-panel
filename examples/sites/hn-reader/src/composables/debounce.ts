import { onScopeDispose, ref, watch, type Ref } from "vue";

/** A ref following `source`, `delay` ms after it stops changing. */
export function useDebounced<T>(source: Ref<T>, delay: number): Ref<T> {
  const debounced = ref(source.value) as Ref<T>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(source, (value) => {
    clearTimeout(timer);
    timer = setTimeout(() => (debounced.value = value), delay);
  });
  onScopeDispose(() => clearTimeout(timer));
  return debounced;
}
