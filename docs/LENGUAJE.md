# Lenguaje — guía de estilo y glosario

Para Xaviel, pero entendible por cualquiera. Vale igual en inglés (la clave) y en español.

## Guía
1. **Frases cortas.** Una idea por frase. Si lleva una coma larga, son dos frases.
2. **Habla de «tú».** «Tu dinero», «tus cuentas»; nunca «el usuario».
3. **Verbos simples.** «Cuadrar», «pagar», «guardar»; no «conciliar», «amortizar», «capitalizar».
4. **Sin términos de contabilidad** en lo que se ve. Si no se puede cambiar sin perder precisión («Fijo» / «Variable»), se deja y se
   agrega una ayuda corta (ⓘ o línea gris) en el primer sitio donde aparece.
5. **Un nombre por concepto en toda la app.** Si el glosario ya eligió uno, no se inventa otro.
6. **Nada de datos crudos** (ids, valores internos como `image` o `mail`, JSON).
7. **Dinero:** RD$ y US$ nunca se mezclan; lo que es estimación lo dice («Estimación»).
8. Las cadenas entran por `TranslateService` (inglés = clave, español en `translations-es.ts`), sin claves repetidas.

## Glosario «antes → después»
| Antes (clave vieja) | Después (inglés) | Español |
|---|---|---|
| Reconcile / Reconcile account | Match with the bank | Cuadrar con el banco |
| Liquid net worth | Money in your accounts | Dinero en tus cuentas |
| Net worth (after card debt) | After paying your cards | Después de pagar tus tarjetas |
| (nuevo, solo si debes en préstamos) | After your loans | Después de tus préstamos |
| What adds up | See how it adds up | Ver cómo se suma |
| Initial balance | Opening balance | Saldo con el que empezó la cuenta |
| Liquid account (counts in liquid net worth) | Counts as money you can use | Cuenta como dinero que puedes usar |
| Bank fee / tax (optional) | Bank charge (optional) | Cargo del banco (opcional) |
| Risk threshold (% of the limit) | Warn me when I'm on track to spend more than (% of the limit) | Avisarme si voy camino de gastar más de (% del límite) |
| Small purchase: up to (empty = automatic) | Count purchases up to this amount as small ones (empty = automatic) | Contar como pequeñas las compras hasta este monto (vacío = automático) |
| Currency (en Ajustes) | Symbol for your main currency (pesos) | Símbolo de tu moneda principal (pesos) |
| Fixed installment (french) | Same payment every period | Misma cuota cada período |
| Constant principal (german) | Payment goes down over time | La cuota baja con el tiempo |
| Capitalizations per year | Times interest is added per year | Veces al año que se suman los intereses |
| Amortization table | Payment schedule | Calendario de pagos |
| Prudence discount on business income (%) | Safety cut on business income (%) | Recorte de prudencia en ingresos del negocio (%) |
| Base income (presupuesto) | Income used to plan | Ingreso con el que planeas |
| Liquid balance now | Money in your accounts now | Dinero en tus cuentas ahora |
| median (presupuesto) | usual amount | monto habitual |
| ROI (literal) | Return on cost | Retorno sobre el costo |
| `h.source` (image, mail…) | Photo or screenshot, Email… | Foto o captura, Correo… |

Notas:
- «Currency» (moneda) sigue siendo la clave en los formularios de cuentas; solo la sección de Ajustes cambió, porque ahí es **solo el
  símbolo** que se muestra para los pesos. Los dólares siguen como US$ y el valor guardado no cambia.
- La ayuda de «Cargo del banco» no cita un porcentaje: la tasa del impuesto se edita en Ajustes y un número escrito en el texto
  quedaría viejo.

## Pendiente (lo toca otra ronda)
- Tarjeta, Negocio, Ingresos, Metas e IA: «Statement balance», «Utilization», «Cut rule», «Capital recovered», «Working capital»,
  «Gross profit», «Verifiability», «Viability», el JSON del paso de consentimiento. Ver `docs/UX.md`, «Lenguaje por revisar».
- Los nombres de eventos del historial de cambios y de los tipos internos (`reconciliation`, `card-payment`, `convert-transfer`…) los
  traduce el prompt 15 al reescribir el historial.

## Prueba que lo guarda
`src/shared/services/language.spec.ts` falla si una clave vieja del glosario vuelve a una plantilla, a un componente o al mapa ES, o
si el mapa ES repite una clave.
