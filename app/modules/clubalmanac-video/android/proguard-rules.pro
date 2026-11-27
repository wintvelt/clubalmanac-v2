# WP42c: WorkManager maakt de samenvoeger van invoer en de taak van een deel
# via reflectie. R8 (volledige stand) haalt anders hun constructors weg; dan
# faalt elke taak in een release-build ("Could not create Input Merger").
-keep class * extends androidx.work.InputMerger { <init>(); }
-keep class expo.modules.clubalmanacvideo.OriginalPartWorker {
  public <init>(android.content.Context, androidx.work.WorkerParameters);
}
