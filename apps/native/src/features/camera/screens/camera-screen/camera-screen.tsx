import { useRouter } from "expo-router";

import { Camera } from "../../components/camera";

export const CameraScreen = () => {
  const router = useRouter();

  const handleDismiss = () => {
    router.back();
  };

  return <Camera onDismiss={handleDismiss} visible={true} />;
};
