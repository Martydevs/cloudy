<template>
  <div class="min-h-dvh bg-base-200">
    <header class="border-b border-base-300 bg-base-100">
      <div class="mx-auto flex max-w-2xl items-center justify-between p-4">
        <AppLogo />
        <ThemeToggle />
      </div>
    </header>
    <main id="contenido" class="mx-auto max-w-2xl p-4">
      <slot />
    </main>
  </div>
</template>
