import { deserialize, serialize } from '@ungap/structured-clone';

const clone = (value, options) => deserialize(serialize(value, options));

/**
 * Pi AI validates model-issued tool arguments using structuredClone().
 * Node provides it, but Hermes on supported React Native devices may not.
 * Install the standards-compatible fallback before App/Pi modules load.
 */
export const ensureStructuredClone = () => {
  if (typeof global.structuredClone !== 'function') {
    global.structuredClone = clone;
  }
};

ensureStructuredClone();
