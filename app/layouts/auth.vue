<template>
  <div class="flex min-h-dvh flex-col items-center justify-center bg-base-200 px-4 py-8">
    <div class="card w-full max-w-md bg-base-100">
      <div class="card-body p-4 sm:p-8">
        <div class="mb-2 flex items-center justify-between">
          <NuxtLink to="/" class="rounded-field" aria-label="Cloudy, ir al inicio">
            <AppLogo />
          </NuxtLink>
          <ThemeToggle />
        </div>
        <slot />
      </div>
    </div>
  </div>
</template>
