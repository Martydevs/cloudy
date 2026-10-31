// Punto único de validación de los formularios: Regle sobre esquemas zod (`useRegleSchema`). Los componentes usan
// estos dos en lugar de los de `@regle/schemas`, que arrancarían con los modificadores por defecto.
import { defineRegleSchemaConfig } from '@regle/schemas'

export const { useRegleSchema: useFormSchema, inferSchema: inferFormSchema } = defineRegleSchemaConfig({
  // Los errores aparecen al salir del campo ($touch) o al enviar ($validate), nunca mientras se escribe.
  modifiers: { autoDirty: false },
})
