const immutableSnapshot = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value)) as T;

export class SerializedSettingsPersistence<T> {
  private queue: Promise<void> = Promise.resolve();

  enqueue(
    value: T,
    persist: (snapshot: T) => Promise<void>,
    afterPersist: () => void,
  ): Promise<void> {
    const snapshot = immutableSnapshot(value);
    const operation = this.queue.then(async () => {
      await persist(snapshot);
      afterPersist();
    });
    this.queue = operation.catch((): void => undefined);
    return operation;
  }
}
