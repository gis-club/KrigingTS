export {}

declare global {
  interface Array<T> {
    max(): number
    min(): number
    mean(): number
    pip(x: number, y: number): boolean
  }
}
