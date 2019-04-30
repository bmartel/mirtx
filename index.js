import stream from "mithril/stream";

const mergeReferences = (obj1, obj2) => {
  Object.keys(obj2).forEach(key => {
    const descriptor1 = Object.getOwnPropertyDescriptor(obj1, key);
    const descriptor2 = Object.getOwnPropertyDescriptor(obj2, key);

    let mergedDescriptor = null;
    let mergedValue = null;
    if (descriptor1 && typeof descriptor1.get === "function") {
      mergedValue = descriptor1.get();
      mergedDescriptor = descriptor1;
    }
    if (descriptor2 && typeof descriptor2.get === "function") {
      mergedValue =
        mergedValue && typeof mergedValue === "object"
          ? defaultMerge(mergedValue, descriptor2.get())
          : descriptor2.get();
      mergedDescriptor = mergedDescriptor || descriptor2;
    }
    if (mergedDescriptor) {
      mergedDescriptor.set(mergedValue);
      Object.defineProperty(obj1, key, mergedDescriptor);
      Object.defineProperty(obj2, key, mergedDescriptor);
    }
  });

  return obj1;
};

export const segment = (key, segments, id = "id") => ({
  id,
  key,
  segments: segments && Object.entries(segments)
});

const reactiveValue = (value, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor && typeof descriptor.get === "function") return value;

  const __dep = stream(value[key]);

  Object.defineProperty(value, key, {
    get: function reactiveGetter() {
      return __dep();
    },
    set: function reactiveSetter(val) {
      __dep(val);
    },
    enumerable: true,
    configurable: true
  });

  return value;
};

const reactiveObject = value => {
  if (value && typeof value === "object") {
    Object.keys(value).forEach(dep => {
      if (value[dep] && typeof value[dep] === "object") {
        reactiveObject(value[dep]);
      } else {
        reactiveValue(value, dep);
      }
    });
  }

  return value;
};

export class Store {
  constructor() {
    this.$$data = {};
    reactiveValue(this, "$$data");
  }

  reactive(segment, data) {
    reactiveObject(data);

    return this.watch(segment, data);
  }

  watch(segment, data) {
    if (!data || typeof data !== "object") throw Error("Invalid data");

    if (Array.isArray(segment)) {
      if (!Array.isArray(data)) throw Error(`Expected ${segment.key} array`);

      data.forEach(value => {
        this.watch(segment[0], value);
      });

      return data;
    }

    if (segment.segments) {
      for (const [depKey, depSegment] of segment.segments) {
        const depData = data[depKey];
        if (depData) {
          this.watch(depSegment, depData);
        }
      }
    }

    this.write(segment, data);

    return data;
  }

  read(segment) {
    if (Array.isArray(segment)) {
      const read = this.read(segment[0]);
      return valueIds => (Array.isArray(valueIds) ? valueIds.map(read) : null);
    }
    const segmentValues = this.$$data[segment.key];
    return valueId =>
      valueId in segmentValues ? segmentValues[valueId].value : null;
  }

  write(segment, data) {
    if (!(segment.key in this.$$data)) {
      this.$$data[segment.key] = {};
      reactiveValue(this.$$data, segment.key);
    }

    const valueId = data[segment.id];

    if (!(valueId in this.$$data[segment.key])) {
      this.$$data[segment.key][valueId] = { value: data, refs: 1 };
      reactiveObject(this.$$data[segment.key][valueId]);
      return;
    }

    this.$$data[segment.key][valueId].refs += 1;

    // apply any updates and swap references
    mergeReferences(this.$$data[segment.key][valueId].value, data);
  }

  delete(segment, valueId) {
    if (Array.isArray(valueId)) {
      return valueId.map(id => this.delete(segment, id));
    }
    const segmentValues = this.$$data[segment.key];
    if (!segmentValues) {
      return;
    }
    const valueEntry = segmentValues[valueId];
    if (!valueEntry) {
      return;
    }

    if (valueEntry.refs > 1) {
      valueEntry.refs -= 1;
    } else {
      delete segmentValues[valueId];
    }

    if (segment.segments) {
      for (const [depKey, depSegment] of segment.segments) {
        if (depKey !== depSegment.key && depKey in valueEntry.value) {
          try {
            if (Array.isArray(depSegment)) {
              valueEntry.value[depKey].forEach(value =>
                this.delete(depSegment[0], value[depSegment[0].id])
              );
            } else {
              this.delete(depSegment, valueEntry.value[depKey][depSegment.id]);
            }
          } catch (err) {}
        }
      }
    }
  }
}
