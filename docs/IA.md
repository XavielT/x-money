# Directriz de IA (contrato)

Aún no hay código de IA. Este documento es el contrato que deben respetar los prompts 10 y 11.

## Principios
- La IA es una capacidad **transversal**, no un chatbot ni una sección aparte: analiza, automatiza tareas, detecta
  patrones, genera recomendaciones y facilita decisiones en todos los módulos donde aporte valor real.
- No se implementa IA por agregarla: cada integración debe resolver un problema concreto, mejorar la experiencia o
  dar información difícil de obtener de otra forma.
- **Determinismo:** las operaciones financieras y los cálculos críticos son lógica determinística (`shared/domain`);
  la IA asiste, no inventa ni modifica cifras.

## Arquitectura
- Modular y sin acoplarse a un proveedor o modelo.
- Una capa única y reutilizable para llamar a modelos; cambiar de proveedor/modelo sin tocar cada módulo.
- Control de tokens, solicitudes y costos; manejo de errores, límites y tiempos de espera.

## Privacidad
- Los datos financieros del usuario solo se usan cuando son necesarios y con controles.
- Aunque los datos viven en `x-core`, la IA **no lee la base**: la app calcula y manda solo lo necesario.
- Decisión de Xaviel (03/11/2026): solo agregados y con opt-in; para categorizar un gasto sale únicamente el texto de
  esa nota; todo se activa en Ajustes y se puede apagar.

## Credenciales y backend
- Ninguna API key en el frontend, el repo, código público ni variables accesibles al cliente; solo variables de
  entorno de un backend que controle las solicitudes. Se evalúa aislamiento de credenciales, permisos, límites de
  consumo y costos por proyecto.
- Backend decidido por Xaviel (03/11/2026): proyecto de Supabase **`x-core`** (su cuenta personal, donde vive el
  backend de sus apps propias), con cuentas propias de X Money (no Supabase Auth). No se usa ni se enlaza el
  Supabase de SGC ni de csd-app (son del trabajo).
- API key de Anthropic: Xaviel tiene autorización para reutilizar la misma key que usan SGC y csd-app (decisión del
  03/11/2026). La reutilización es de la **credencial**, no de los proyectos: la key se guarda como secreto de la
  función de `x-core`, copiada por Xaviel a mano; nunca pasa por el repo, el cliente, el chat ni los archivos `.env`
  que Claude Code pueda leer. Como el costo cae en la cuenta del trabajo, la función registra el uso de X Money por
  separado (tabla `xmoney.ai_usage`) y aplica topes propios, para medir y limitar cuánto consume la app personal.
- La service role key de Supabase jamás entra a la app.

## Base determinística (2.15.0)

La IA de los prompts 10 y 11 **narra y explica** lo que `shared/domain/insights/` ya calculó: cada `Insight` trae su evidencia (cifras con periodo e ids de movimientos), su fórmula, su estado de dato (`confirmed` / `estimate`) y su huella. Los candidatos a duplicados (`SmartInsightService.duplicateCandidates`) también alimentan la IA. La IA no calcula ni modifica ninguna cifra; todo lo que proyecta es `Estimate<T>` con sus supuestos.

## Funciones de IA (a llenar en el prompt 11)

| Función de IA | Problema que resuelve | Alternativa determinística | Decisión |
|---|---|---|---|
| | | | |
