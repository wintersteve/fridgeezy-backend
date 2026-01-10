import * as Notifications from "expo-notifications";
import { SchedulableTriggerInputTypes } from "expo-notifications/src/Notifications.types";
import { useEffect, useRef } from "react";

export const useTestNotification = () => {
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    const setupAndSchedule = async () => {
      try {
        const { status } = await Notifications.requestPermissionsAsync();

        if (status === "granted" && isMountedRef.current) {
          console.log("se");
          await Notifications.scheduleNotificationAsync({
            content: {
              title: "Fridgeezy Test",
              body: "Push notifications are working!",
              sound: true,
              badge: 1,
            },
            trigger: {
              seconds: 5,
              type: SchedulableTriggerInputTypes.TIME_INTERVAL,
            },
          });
        }
      } catch (error) {
        console.error("Notification test failed:", error);
      }
    };

    setupAndSchedule();

    return () => {
      isMountedRef.current = false;
    };
  }, []);
};
